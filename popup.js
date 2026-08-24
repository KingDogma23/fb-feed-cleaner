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

function render(d) {
  const on = $("enabled").checked;
  $("stateText").textContent = on ? "Protection on" : "Protection off";
  $("stateSub").textContent = on
    ? "Feed clutter hidden as it loads"
    : "Facebook is showing you everything";

  if (!d) {
    $("ver").textContent = "";
    $("diag").textContent =
      "Not running on this tab.\n\nOpen a facebook.com tab, or reload it — a " +
      "content script only attaches at page load. If you just updated the " +
      "extension, reload it on chrome://extensions first.";
    lastReport = $("diag").textContent;
    return;
  }

  $("ver").textContent = "v" + d.version;

  const lt = d.lifetime || { sponsored: 0, follow: 0, join: 0 };
  $("sAds").textContent = compact(lt.sponsored);
  $("sSug").textContent = compact(lt.follow);
  $("sGrp").textContent = compact(lt.join);

  const rules = Object.entries(d.byRule || {}).map(([k, v]) => `${k}=${v}`).join(" ");
  const reasons = Object.entries(d.reasons || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([why, n]) => `  ${n} x ${why}`)
    .join("\n");

  lastReport = [
    `Quiet for Facebook v${d.version}  (page ${d.url})`,
    `all time: ${lt.sponsored} ads, ${lt.follow} suggested posts, ${lt.join} groups`,
    `on: ${Object.entries(d.settings).filter(([, v]) => v).map(([k]) => k).join(", ") || "nothing"}`,
    `hidden this page: ${d.hidden}${rules ? "  [" + rules + "]" : ""}`,
    `labels seen: ${d.labelsSeen} (${d.labelsByRender ?? 0} needed de-obfuscating)`,
    `sweep: examined ${d.render?.examined ?? 0}, feed cells ${d.render?.feedCells ?? 0} ` +
      `(${d.render?.cardsNoHeading ?? 0} heading-less)`,
    reasons ? `rejected:\n${reasons}` : `rejected: none`,
    d.session?.samples?.length
      ? `meta rows not matched:\n` + d.session.samples.map((x) => `  ${x}`).join("\n")
      : `meta rows: none captured`,
    `page: main=${d.structure.roleMain} headings=${d.structure.headings} ` +
      `articles=${d.structure.articles} feeds=${d.structure.feeds}`,
  ].join("\n");

  $("diag").textContent = lastReport;
}

async function refresh() {
  render(await tell({ type: "diagnostics" }));
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
