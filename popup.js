const DEFAULTS = {
  enabled: true,
  hideFollow: true,
  hideJoin: false,
  hideSponsored: true,
  strict: false,
  placeholder: false,
  badge: false,
};

const KEYS = Object.keys(DEFAULTS);
const countEl = document.getElementById("count");

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Content script is only present on facebook.com; ignore failures elsewhere. */
async function tell(message) {
  const tab = await activeTab();
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    return null;
  }
}

const diagEl = document.getElementById("diag");
const verEl = document.getElementById("ver");
let lastReport = "";

/**
 * The version shown here is the one actually running in the page, not the one
 * in the manifest — those differ whenever Chrome is still serving an older
 * build because the extension was not reloaded after an update.
 */
function renderDiagnostics(d) {
  if (!d) {
    verEl.textContent = "";
    diagEl.textContent =
      "Not running on this tab.\n\n" +
      "Open a facebook.com tab, or reload it — a content script only attaches " +
      "at page load. If you just updated the extension, reload it on " +
      "chrome://extensions first.";
    lastReport = diagEl.textContent;
    return;
  }

  verEl.textContent = "v" + d.version;
  const on = Object.entries(d.settings)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .join(", ");
  const rules = Object.entries(d.byRule).map(([k, v]) => `${k}=${v}`).join(" ");
  const reasons = Object.entries(d.reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([why, n]) => `  ${n} x ${why}`)
    .join("\n");

  lastReport = [
    `FB Feed Cleaner v${d.version}  (page ${d.url})`,
    `on: ${on || "nothing"}`,
    `hidden: ${d.hidden}${rules ? "  [" + rules + "]" : ""}`,
    `labels seen: ${d.labelsSeen} (${d.labelsByRender ?? 0} needed de-obfuscating)`,
    `SESSION: ${d.session?.sweeps ?? 0} sweeps run, ` +
      `${d.session?.sweepMatches ?? 0} ads found by de-obfuscating, ` +
      `feed cells seen ${d.session?.feedCells ?? 0}`,
    `this scan: examined ${d.render?.examined ?? 0}, ` +
      `feed cells ${d.render?.feedCells ?? 0} (${d.render?.cardsNoHeading ?? 0} heading-less), ` +
      `skipped ${d.render?.skippedDecided ?? 0} decided / ` +
      `${d.render?.skippedBudget ?? 0} cooldown / ${d.render?.skippedEmpty ?? 0} empty`,
    reasons ? `rejected:\n${reasons}` : "rejected: none",
    (d.session?.samples?.length
      ? `meta rows the sweep could not match:\n` +
        d.session.samples.map((x) => `  ${x}`).join("\n")
      : `meta rows: none captured`),
    `page: main=${d.structure.roleMain} headings=${d.structure.headings} ` +
      `articles=${d.structure.articles} feeds=${d.structure.feeds}`,
  ].join("\n");

  diagEl.textContent = lastReport;
}

async function refreshCount() {
  const stats = await tell({ type: "getStats" });
  countEl.textContent = stats ? String(stats.visible) : "not on Facebook";
  renderDiagnostics(await tell({ type: "diagnostics" }));
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  for (const key of KEYS) {
    document.getElementById(key).checked = stored[key];
  }
});

for (const key of KEYS) {
  document.getElementById(key).addEventListener("change", (e) => {
    chrome.storage.sync.set({ [key]: e.target.checked });
    setTimeout(refreshCount, 400);
  });
}

document.getElementById("rescan").addEventListener("click", async () => {
  await tell({ type: "rescan" });
  refreshCount();
});

document.getElementById("showAll").addEventListener("click", async () => {
  await tell({ type: "unhideAll" });
  refreshCount();
});

document.getElementById("copy").addEventListener("click", async (e) => {
  await navigator.clipboard.writeText(lastReport);
  e.target.textContent = "Copied";
  setTimeout(() => (e.target.textContent = "Copy report"), 1200);
});

refreshCount();
