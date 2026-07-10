/**
 * Isolated world — relay MAIN-world postMessage → background service worker.
 */
window.addEventListener("message", (ev) => {
  try {
    const d = ev.data;
    if (!d || d.source !== "glabs-grok-statsig" || !d.statsig_id) return;
    chrome.runtime.sendMessage({
      type: "statsig_captured",
      statsig_id: String(d.statsig_id),
      via: "page_fetch_hook",
    });
  } catch (_) {}
});
