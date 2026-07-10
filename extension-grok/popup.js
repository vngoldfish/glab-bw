function cls(el, kind) {
  el.className = kind || "";
}

chrome.runtime.sendMessage({ type: "status" }, (st) => {
  if (!st) return;
  const conn = document.getElementById("conn");
  const tab = document.getElementById("tab");
  const sig = document.getElementById("sig");
  const via = document.getElementById("via");
  const err = document.getElementById("err");

  conn.textContent = st.connected ? "OK" : "OFF";
  cls(conn, st.connected ? "ok" : "bad");

  tab.textContent = st.grokTab || "closed";
  cls(tab, st.grokTab && st.grokTab !== "closed" ? "ok" : "warn");

  if (st.hasStatsig) {
    sig.textContent = st.lastStatsigLen
      ? `yes (${st.lastStatsigLen} chars)`
      : "yes";
    cls(sig, "ok");
  } else {
    sig.textContent = "chưa — gen 1 ảnh trên web";
    cls(sig, "warn");
  }

  via.textContent = st.via || "—";
  err.textContent = st.lastError || "—";
  if (st.lastError) cls(err, "bad");
});
