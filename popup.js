const DEFAULTS = {
  enabled: true,
  hideSponsored: true,
  hideFollow: true,
  hideJoin: false,
  hideRail: true,
  strict: false,
  placeholder: false,
  badge: false,
};

const KEYS = Object.keys(DEFAULTS);
const $ = (id) => document.getElementById(id);
let lastReport = "";

/**
 * The popup outlives a reload badly too: if the extension is reloaded while
 * this window is open, chrome.storage becomes undefined and every handler
 * below throws into the extension's error log. Same guard as the content
 * script.
 */
function alive() {
  try {
    return !!(chrome.runtime && chrome.runtime.id && chrome.storage);
  } catch {
    return false;
  }
}

async function tell(message) {
  if (!alive()) return null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    return null;
  }
}

const compact = (n) => (n >= 10000 ? Math.round(n / 1000) + "k" : (n || 0).toLocaleString());

/**
 * All-time totals, read from storage rather than from the page.
 *
 * The counters used to come only from the content script, so opening the popup
 * on any tab that is not Facebook rendered 0 / 0 / 0 — the numbers are sitting
 * in storage the whole time, but the panel showed nothing and looked broken.
 * Reported from a live profile on 2026-08-28, with the popup opened on a
 * non-Facebook tab.
 */
async function storedLifetime() {
  if (!alive()) return null;
  try {
    const got = await chrome.storage.local.get({ quietLifetime: null });
    return got.quietLifetime;
  } catch {
    return null;
  }
}

function render(d, stored) {
  const on = $("enabled").checked;
  $("stateText").textContent = on ? "Protection on" : "Protection off";
  // "hidden as it loads" was a timing claim the code does not deliver: the
  // harness records a newly arrived ad taking ~1.5s and the post painting at
  // full height first, which is why the feed visibly jumps. It is recorded
  // there and deliberately not asserted, because it is a known-unfixed defect.
  // Say what can be demonstrated instead — the same correction the sibling
  // YouTube listing needed when "stops most video ads loading" was pulled.
  $("stateSub").textContent = on
    ? "Ads and suggestions hidden"
    : "Facebook is showing you everything";

  // Totals first, and from whichever source has them: they are all-time figures
  // and have nothing to do with which tab happens to be open.
  const lt = d?.lifetime || stored || { sponsored: 0, follow: 0, join: 0 };
  $("sAds").textContent = compact(lt.sponsored);
  $("sSug").textContent = compact(lt.follow);
  $("sGrp").textContent = compact(lt.join);

  if (!d) {
    $("ver").textContent = "";
    $("diag").textContent =
      "The totals above are all-time, and this tab is not Facebook.\n\n" +
      "Open a facebook.com tab to see what is being hidden right now. If you " +
      "are on Facebook and still seeing this, reload the page — a content " +
      "script only attaches at page load.";
    lastReport = $("diag").textContent;
    return;
  }

  $("ver").textContent = "v" + d.version;

  const rules = Object.entries(d.byRule || {}).map(([k, v]) => `${k}=${v}`).join(" ");
  const reasons = Object.entries(d.reasons || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([why, n]) => `  ${n} x ${why}`)
    .join("\n");

  // WHICH ARM THIS IS, first line, always — the same "ARM:" marker the other
  // three extensions use, so a pasted readout always announces itself and the
  // four reports can be read the same way. The loud void lines below are kept:
  // when either is set, every number under them is meaningless.
  // The build this popup file came from. Chrome serves popup.js fresh from disk
  // while the content script is whatever was injected at page load, so the two
  // disagree after a reload — and a report from the older build looks exactly
  // like a current one. That just happened: a 2.6.7 report was read as though
  // it were 2.6.8, and nothing in it said otherwise.
  const POPUP_VERSION = "2.6.10";
  const skew = d.version && d.version !== POPUP_VERSION
    ? `\n!! STALE PAGE: this tab is running content script v${d.version} but the ` +
      `popup is v${POPUP_VERSION}. Reload the extension AND refresh the Facebook ` +
      `tab, then take the reading again — anything the older build does not send ` +
      `will simply be missing from this report.`
    : "";

  const arm = d.bypassed
    ? "ARM: BYPASSED (?fbfcoff=1) — hiding nothing"
    : !d.settings?.enabled
      ? "ARM: OFF via the popup toggle — hiding nothing"
      : "ARM: ACTIVE — hiding";

  lastReport = [
    arm + skew,
    `Quite for Facebook v${d.version}  (page ${d.url})`,
    // First and loud: when either of these is set every number below is void,
    // and a report that omits them is indistinguishable from a broken build.
    d.bypassed ? `** BYPASSED (?fbfcoff=1) — nothing below means anything **` : null,
    d.tabHidden === "1" ? `** TAB WAS HIDDEN — rects read zero, reading is void **` : null,
    d.refusedOverreach ? `refused as over-reaching: ${d.refusedOverreach}` : null,
    `all time: ${lt.sponsored} ads, ${lt.follow} suggested posts, ${lt.join} groups`,
    `on: ${Object.entries(d.settings).filter(([, v]) => v).map(([k]) => k).join(", ") || "nothing"}`,
    `hidden this page: ${d.hidden}${rules ? "  [" + rules + "]" : ""}`,
    d.anchor
      ? `scroll anchoring: page=${d.anchor.scroller} feed=${d.anchor.feed}` +
        `   (auto = collapsing above you is invisible; none = it shifts the page)\n` +
        `hidden posts right now: ${d.anchor.hiddenAboveViewport} above you, ` +
        `${d.anchor.hiddenInViewport} on screen   scan debounce ${d.anchor.debounceMs}ms`
      : null,
    `labels seen: ${d.labelsSeen} this scan (${d.labelsByRender ?? 0} de-obfuscated)`,
    `labels seen THIS SESSION: ${d.sessionLabels ?? "no reading"} across ` +
      `${d.sessionScans ?? "no reading"} scans` +
      (d.sessionScans === 0
        ? "   <-- the scan has never run; this is not 'no ads found'"
        : d.sessionLabels === 0
          ? "   <-- scans ran and found NO labels at all: matching is broken"
          : ""),
    // Session totals, not the per-scan tally. `tally` is reassigned at the top
    // of every scan and refresh() does not trigger one, so this line used to
    // report whatever the last 60ms mutation-driven pass happened to leave —
    // routinely "examined 0" on a page where the extension is working perfectly.
    // The session counters were built precisely to answer "has this ever
    // worked?" and were then never rendered.
    `sweep: ${d.session?.sweeps ?? 0} swept, ${d.session?.sweepMatches ?? 0} labels recovered, ` +
      `${d.session?.feedCells ?? 0} feed cells (this scan: ${d.render?.examined ?? 0}, ` +
      `${d.render?.cardsNoHeading ?? 0} heading-less)`,
    reasons ? `rejected:\n${reasons}` : `rejected: none`,
    d.session?.samples?.length
      ? `meta rows not matched:\n` + d.session.samples.map((x) => `  ${x}`).join("\n")
      : `meta rows: none captured`,
    `page: main=${d.structure.roleMain} headings=${d.structure.headings} ` +
      `articles=${d.structure.articles} feeds=${d.structure.feeds}`,
  ].filter(Boolean).join("\n");

  $("diag").textContent = lastReport;
}

async function refresh() {
  const [live, stored] = await Promise.all([tell({ type: "diagnostics" }), storedLifetime()]);
  render(live, stored);
}

function applyStored(stored) {
  for (const k of KEYS) $(k).checked = (stored || DEFAULTS)[k];
  refresh();
}

if (alive()) {
  try {
    chrome.storage.sync.get(DEFAULTS, applyStored);
  } catch {
    applyStored(null);
  }
} else {
  applyStored(null);
}

for (const k of KEYS) {
  $(k).addEventListener("change", (e) => {
    if (!alive()) return;
    try {
      chrome.storage.sync.set({ [k]: e.target.checked });
    } catch {
      return;
    }
    setTimeout(refresh, 300);
  });
}

$("copy").addEventListener("click", async (e) => {
  await navigator.clipboard.writeText(lastReport);
  e.target.textContent = "Copied";
  setTimeout(() => (e.target.textContent = "Copy report"), 1200);
});

$("showAll").addEventListener("click", async (e) => {
  await tell({ type: "unhideAll" });
  e.target.textContent = "Shown";
  setTimeout(() => {
    e.target.textContent = "Show all";
    refresh();
  }, 900);
});

$("reset").addEventListener("click", (e) => {
  if (!alive()) return;
  try {
    chrome.storage.local.set({
      quietLifetime: { sponsored: 0, follow: 0, join: 0, since: Date.now() },
    });
  } catch {
    return;
  }
  e.target.textContent = "Reset";
  setTimeout(() => {
    e.target.textContent = "Reset";
    refresh();
  }, 900);
});
