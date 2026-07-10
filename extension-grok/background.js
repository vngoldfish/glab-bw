/**
 * G-Labs BW — Grok Statsig companion (required for VIDEO anti-bot)
 *
 * Alongside official Auth Helper:
 *  - Capture real x-statsig-id (page hook + webRequest + scrape)
 *  - Re-inject into page fetch so Auth Helper gfetch gets a real token
 *  - POST /sync/statsig for backend headers
 *  - NEVER navigates/reloads grok tab
 */

const BRIDGE = "http://127.0.0.1:18923";
const EXT_ID = `glabs-grok-statsig-${chrome.runtime.id}`;
const POLL_MS = 800;

let lastStatus = {
  connected: false,
  grokTab: "closed",
  hasStatsig: false,
  lastError: "",
  polls: 0,
  lastStatsigLen: 0,
  via: "",
};

let cachedStatsig = "";
let cachedAt = 0;

function setBadge(text, color) {
  try {
    chrome.action.setBadgeText({ text: text || "" });
    if (color) chrome.action.setBadgeBackgroundColor({ color });
  } catch (_) {}
}

function rememberStatsig(id, via) {
  const val = (id || "").trim();
  if (!val || val.length < 8) return false;
  // Always accept longer/newer tokens (Grok may rotate)
  if (val === cachedStatsig && Date.now() - cachedAt < 30_000) {
    lastStatus.hasStatsig = true;
    return true;
  }
  cachedStatsig = val;
  cachedAt = Date.now();
  lastStatus.hasStatsig = true;
  lastStatus.lastStatsigLen = val.length;
  lastStatus.via = via || "";
  lastStatus.lastError = "";
  return true;
}

async function findGrokTab() {
  const tabs = await chrome.tabs.query({});
  const imagine = tabs.filter(
    (t) => t.url && t.url.startsWith("https://grok.com/imagine"),
  );
  if (imagine.length) {
    imagine.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return imagine[0];
  }
  return (
    tabs.find((t) => t.url && /^https:\/\/grok\.com(\/|$)/.test(t.url)) || null
  );
}

async function scrapeStatsig(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        // Prefer live hook cache
        try {
          if (
            typeof window.__glabsGetStatsig === "function" &&
            window.__glabsGetStatsig()
          ) {
            return {
              statsig: window.__glabsGetStatsig(),
              via: "page_hook_mem",
            };
          }
          if (window.__glabsLastStatsig) {
            return {
              statsig: window.__glabsLastStatsig,
              via: "page_hook_var",
            };
          }
        } catch (_) {}

        const out = {};
        try {
          const ss = sessionStorage.getItem("__glabs_statsig");
          if (ss) return { statsig: ss, via: "sessionStorage" };
        } catch (_) {}

        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            const low = k.toLowerCase();
            if (low.includes("statsig") || low.includes("x-statsig")) {
              out[k] = localStorage.getItem(k);
            }
          }
          for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (!k) continue;
            const low = k.toLowerCase();
            if (low.includes("statsig") || low.includes("x-statsig")) {
              out[`session:${k}`] = sessionStorage.getItem(k);
            }
          }
        } catch (e) {
          return { error: String(e) };
        }

        let statsig =
          out["x-statsig-id"] ||
          out["X-STATSIG-ID"] ||
          out["session:x-statsig-id"] ||
          null;
        if (!statsig) {
          for (const [k, v] of Object.entries(out)) {
            if (!v || String(v).length < 20) continue;
            if (!k.toLowerCase().includes("statsig")) continue;
            try {
              const j = JSON.parse(v);
              if (j && typeof j === "object") {
                statsig =
                  j.statsigId ||
                  j.stableID ||
                  j["x-statsig-id"] ||
                  null;
              }
            } catch (_) {
              if (String(v).length < 900) statsig = String(v);
            }
          }
        }
        return { statsig, keys: Object.keys(out), via: "storage" };
      },
    });
    return result || {};
  } catch (e) {
    return { error: String(e) };
  }
}

/** Ensure fetch-hook is present (SPA / after Auth Helper navigation). */
async function ensureHook(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["content_hook.js"],
    });
  } catch (_) {
    // already injected or no permission
  }
}

async function pushStatsig(statsigId, source) {
  if (!statsigId) return false;
  try {
    const res = await fetch(`${BRIDGE}/sync/statsig`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ext-Id": EXT_ID,
      },
      body: JSON.stringify({
        statsig_id: statsigId,
        source: source || "extension",
      }),
    });
    return res.ok;
  } catch (e) {
    lastStatus.lastError = String(e);
    return false;
  }
}

async function ensurePushed() {
  if (!cachedStatsig) return false;
  return pushStatsig(cachedStatsig, lastStatus.via || "cache");
}

// Capture from any Grok / xAI outbound request
try {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      try {
        const headers = details.requestHeaders || [];
        for (const h of headers) {
          if (
            h &&
            h.name &&
            h.name.toLowerCase() === "x-statsig-id" &&
            h.value
          ) {
            if (rememberStatsig(h.value, "webRequest")) {
              pushStatsig(h.value, "webRequest");
            }
            break;
          }
        }
      } catch (_) {}
    },
    {
      urls: [
        "https://grok.com/*",
        "https://*.grok.com/*",
        "https://*.x.ai/*",
      ],
    },
    ["requestHeaders", "extraHeaders"],
  );
} catch (e) {
  console.warn("webRequest listener failed", e);
}

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg && msg.type === "status") {
    sendResponse({
      ...lastStatus,
      hasStatsig: Boolean(cachedStatsig) || lastStatus.hasStatsig,
    });
    return true;
  }
  if (msg && msg.type === "statsig_captured" && msg.statsig_id) {
    if (rememberStatsig(msg.statsig_id, msg.via || "page_hook")) {
      pushStatsig(msg.statsig_id, msg.via || "page_hook").then((ok) => {
        sendResponse({ ok });
      });
      return true;
    }
    sendResponse({ ok: false });
    return true;
  }
  return false;
});

// Re-hook when Grok tab finishes loading (Auth Helper force_refresh navigates)
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete") return;
  if (!tab.url || !tab.url.includes("grok.com")) return;
  ensureHook(tabId).then(() => scrapeStatsig(tabId)).then((scraped) => {
    if (scraped && scraped.statsig) {
      if (rememberStatsig(String(scraped.statsig), scraped.via || "nav_scrape")) {
        pushStatsig(String(scraped.statsig), scraped.via || "nav_scrape");
      }
    }
  });
});

async function tick() {
  lastStatus.polls += 1;
  const tab = await findGrokTab();
  lastStatus.grokTab = tab
    ? tab.url && tab.url.startsWith("https://grok.com/imagine")
      ? "imagine"
      : "open"
    : "closed";

  try {
    const wantedRes = await fetch(`${BRIDGE}/sync/statsig-wanted`, {
      headers: { "X-Ext-Id": EXT_ID },
    });
    lastStatus.connected = wantedRes.ok;
    if (!wantedRes.ok) {
      setBadge("OFF", "#ef4444");
      lastStatus.lastError =
        wantedRes.status === 404
          ? "bridge thiếu /sync/statsig — restart backend"
          : `bridge HTTP ${wantedRes.status}`;
      return;
    }
    const wanted = await wantedRes.json();

    if (tab && tab.id != null) {
      await ensureHook(tab.id);
    }

    // Keep bridge warm when we have token
    if (cachedStatsig && (wanted.wanted || !wanted.has)) {
      await ensurePushed();
    }

    // Scrape when wanted or missing
    if (tab && tab.id != null && (wanted.wanted || !wanted.has || !cachedStatsig)) {
      const scraped = await scrapeStatsig(tab.id);
      if (scraped.error) {
        lastStatus.lastError = scraped.error;
      } else if (scraped.statsig) {
        if (rememberStatsig(String(scraped.statsig), scraped.via || "scrape")) {
          await pushStatsig(String(scraped.statsig), scraped.via || "scrape");
        }
      } else if (!cachedStatsig) {
        lastStatus.hasStatsig = false;
        lastStatus.lastError =
          "chưa có x-statsig-id — gen 1 CLIP/ẢNH trên grok.com/imagine (giữ tab)";
      }
    }

    await fetch(`${BRIDGE}/sync/theme`, {
      headers: {
        "X-Ext-Id": EXT_ID,
        "X-Tab-Status": "closed",
        "X-Grok-Tab-Status": tab ? "open" : "closed",
      },
    }).catch(() => {});

    const ok = Boolean(cachedStatsig);
    lastStatus.hasStatsig = ok;
    setBadge(
      tab ? (ok ? "OK" : "…") : "TAB",
      tab ? (ok ? "#22c55e" : "#eab308") : "#64748b",
    );
  } catch (e) {
    lastStatus.connected = false;
    lastStatus.lastError = String(e);
    setBadge("OFF", "#ef4444");
  }
}

async function loop() {
  try {
    await tick();
  } catch (e) {
    lastStatus.lastError = String(e);
  }
  setTimeout(loop, POLL_MS);
}

chrome.runtime.onInstalled.addListener(() => setBadge("…", "#64748b"));
loop();
