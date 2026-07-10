/**
 * MAIN world on grok.com — capture + re-inject x-statsig-id.
 *
 * Auth Helper gfetch runs fetch() in MAIN world too, so it goes through this
 * wrapper. After user gens once on web, we keep last real token and stamp it
 * onto later app requests (video app-chat) → avoids anti-bot code 7.
 */
(function () {
  if (window.__glabsStatsigHooked) return;
  window.__glabsStatsigHooked = true;
  window.__glabsLastStatsig = window.__glabsLastStatsig || null;

  function pickStatsig(headers) {
    if (!headers) return null;
    try {
      if (typeof headers.get === "function") {
        return (
          headers.get("x-statsig-id") ||
          headers.get("X-Statsig-Id") ||
          headers.get("X-STATSIG-ID") ||
          null
        );
      }
      if (Array.isArray(headers)) {
        for (const pair of headers) {
          if (
            pair &&
            String(pair[0] || "").toLowerCase() === "x-statsig-id" &&
            pair[1]
          ) {
            return String(pair[1]);
          }
        }
        return null;
      }
      if (typeof headers === "object") {
        for (const [k, v] of Object.entries(headers)) {
          if (String(k).toLowerCase() === "x-statsig-id" && v) {
            return String(v);
          }
        }
      }
    } catch (_) {}
    return null;
  }

  function setHeader(headers, name, value) {
    if (!headers) return { [name]: value };
    try {
      if (typeof headers.set === "function") {
        headers.set(name, value);
        return headers;
      }
      if (Array.isArray(headers)) {
        const low = name.toLowerCase();
        let found = false;
        const next = headers.map((pair) => {
          if (pair && String(pair[0] || "").toLowerCase() === low) {
            found = true;
            return [pair[0], value];
          }
          return pair;
        });
        if (!found) next.push([name, value]);
        return next;
      }
      if (typeof headers === "object") {
        const out = Object.assign({}, headers);
        // remove other casings
        for (const k of Object.keys(out)) {
          if (String(k).toLowerCase() === "x-statsig-id") delete out[k];
        }
        out[name] = value;
        return out;
      }
    } catch (_) {}
    return headers;
  }

  function emit(id) {
    if (!id || String(id).length < 8) return;
    const val = String(id);
    window.__glabsLastStatsig = val;
    try {
      window.postMessage(
        { source: "glabs-grok-statsig", statsig_id: val },
        "*",
      );
    } catch (_) {}
  }

  function needsStatsig(url) {
    if (!url) return false;
    const u = String(url);
    return (
      u.includes("grok.com/rest") ||
      u.includes("grok.com/ws") ||
      u.includes("/app-chat/") ||
      u.includes("/media/")
    );
  }

  function resolveUrl(input) {
    try {
      if (typeof input === "string") return input;
      if (input && typeof input.url === "string") return input.url;
      if (input && typeof input.href === "string") return input.href;
    } catch (_) {}
    return "";
  }

  try {
    const ls =
      localStorage.getItem("x-statsig-id") ||
      localStorage.getItem("X-STATSIG-ID");
    if (ls) emit(ls);
  } catch (_) {}

  // Restore from session if page soft-navigated
  try {
    const mem = sessionStorage.getItem("__glabs_statsig");
    if (mem && mem.length > 8) emit(mem);
  } catch (_) {}

  function persist(id) {
    emit(id);
    try {
      sessionStorage.setItem("__glabs_statsig", id);
    } catch (_) {}
  }

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      try {
        const url = resolveUrl(input);
        let opts = init;
        // Clone init so we can mutate headers
        if (needsStatsig(url)) {
          opts = init ? Object.assign({}, init) : {};
          let headers = opts.headers;
          // Request object as input may carry headers
          if (!headers && input && typeof input === "object" && input.headers) {
            headers = input.headers;
          }
          const existing = pickStatsig(headers);
          if (existing) {
            persist(existing);
          } else if (window.__glabsLastStatsig) {
            headers = setHeader(
              headers || {},
              "x-statsig-id",
              window.__glabsLastStatsig,
            );
            opts.headers = headers;
          }
        } else {
          const hdrs =
            (init && init.headers) ||
            (input && typeof input === "object" && input.headers) ||
            null;
          const sid = pickStatsig(hdrs);
          if (sid) persist(sid);
        }
        return origFetch.call(this, input, opts || init);
      } catch (_) {
        return origFetch.apply(this, arguments);
      }
    };
  }

  const XO = window.XMLHttpRequest;
  if (XO && XO.prototype) {
    const origSet = XO.prototype.setRequestHeader;
    const origOpen = XO.prototype.open;
    const origSend = XO.prototype.send;
    XO.prototype.open = function (method, url) {
      this.__glabsUrl = url;
      this.__glabsHeaders = this.__glabsHeaders || {};
      return origOpen.apply(this, arguments);
    };
    XO.prototype.setRequestHeader = function (name, value) {
      try {
        this.__glabsHeaders = this.__glabsHeaders || {};
        this.__glabsHeaders[String(name).toLowerCase()] = value;
        if (String(name).toLowerCase() === "x-statsig-id" && value) {
          persist(String(value));
        }
      } catch (_) {}
      return origSet.apply(this, arguments);
    };
    XO.prototype.send = function () {
      try {
        if (
          needsStatsig(this.__glabsUrl) &&
          !(this.__glabsHeaders && this.__glabsHeaders["x-statsig-id"]) &&
          window.__glabsLastStatsig
        ) {
          origSet.call(this, "x-statsig-id", window.__glabsLastStatsig);
        }
      } catch (_) {}
      return origSend.apply(this, arguments);
    };
  }

  // Expose for extension scrape
  window.__glabsGetStatsig = function () {
    return window.__glabsLastStatsig || null;
  };
})();
