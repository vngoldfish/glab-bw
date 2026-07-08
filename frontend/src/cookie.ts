const SESSION_NAMES = [
  "__Secure-next-auth.session-token",
  "__secure-next-auth.session-token",
];

export function parseFlowCookieInput(raw: string): { session_token: string; email?: string } {
  const text = raw.trim();
  if (!text) {
    throw new Error("Chưa nhập cookie hoặc session token");
  }

  if (text.startsWith("[")) {
    const cookies = JSON.parse(text) as Array<{ name?: string; value?: string }>;
    if (!Array.isArray(cookies)) {
      throw new Error("Cookie JSON phải là mảng");
    }

    let sessionToken = "";
    let email = "";
    for (const item of cookies) {
      const name = String(item.name || "").trim();
      const value = decodeURIComponent(String(item.value || "").trim());
      if (SESSION_NAMES.includes(name)) {
        sessionToken = value;
      } else if (name.toLowerCase() === "email" && !email) {
        email = value.replace(/^"|"$/g, "");
      }
    }

    if (!sessionToken) {
      throw new Error("Không tìm thấy __Secure-next-auth.session-token trong cookie JSON");
    }
    return email ? { session_token: sessionToken, email } : { session_token: sessionToken };
  }

  if (text.includes("__Secure-next-auth.session-token=")) {
    const match = text.match(/__Secure-next-auth\.session-token=([^;\s]+)/i);
    if (match?.[1]) {
      return { session_token: decodeURIComponent(match[1].trim()) };
    }
  }

  if (text.startsWith("eyJ")) {
    return { session_token: text };
  }

  throw new Error("Dán JSON cookie export hoặc chỉ giá trị session token (bắt đầu bằng eyJ)");
}