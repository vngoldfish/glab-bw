const SESSION_NAMES = [
  "__Secure-next-auth.session-token",
  "__secure-next-auth.session-token",
];

type CookieItem = {
  name?: string;
  value?: string;
  domain?: string;
  host?: string;
};

function domainOf(item: CookieItem): string {
  return String(item.domain || item.host || "")
    .toLowerCase()
    .replace(/^\./, "");
}

function missingFlowTokenMessage(
  domains: string[],
  count: number,
): string {
  const sample = domains.slice(0, 5).join(", ") || "(không có domain)";
  const more = domains.length > 5 ? ` (+${domains.length - 5} domain khác)` : "";
  const onlyUnrelated =
    domains.length > 0 &&
    !domains.some((d) => d.includes("labs.google") || d.endsWith("google.com"));

  if (onlyUnrelated) {
    return (
      `Cookie JSON này không phải Google Flow. Domain: ${sample}${more} (${count} cookie). ` +
      `Cần export từ https://labs.google/fx/tools/flow — phải có ` +
      `__Secure-next-auth.session-token (domain labs.google).`
    );
  }
  if (
    domains.some((d) => d.endsWith("google.com")) &&
    !domains.some((d) => d.includes("labs.google"))
  ) {
    return (
      `Thấy cookie Google (${sample}${more}) nhưng thiếu session-token labs.google. ` +
      `Mở https://labs.google/fx/tools/flow (đã login) rồi export lại.`
    );
  }
  return (
    `Không tìm thấy __Secure-next-auth.session-token trong ${count} cookie ` +
    `(domain: ${sample}${more}). Export khi đang mở labs.google.`
  );
}

/**
 * Parse Flow cookie paste (EditThisCookie JSON array or raw session token).
 * Analyzes domains — rejects unrelated sites (e.g. hosyquan.com) with clear errors.
 */
export function parseFlowCookieInput(raw: string): { session_token: string; email?: string } {
  const text = raw.trim();
  if (!text) {
    throw new Error("Chưa nhập cookie hoặc session token");
  }

  if (text.startsWith("[")) {
    let cookies: CookieItem[];
    try {
      cookies = JSON.parse(text) as CookieItem[];
    } catch {
      throw new Error("Cookie JSON không hợp lệ (không parse được mảng)");
    }
    if (!Array.isArray(cookies)) {
      throw new Error("Cookie JSON phải là mảng [ {...}, ... ]");
    }
    if (cookies.length === 0) {
      throw new Error("Cookie JSON rỗng");
    }

    const domains = new Set<string>();
    const labsTokens: string[] = [];
    const otherTokens: string[] = [];
    let named = 0;

    for (const item of cookies) {
      const name = String(item.name || "").trim();
      if (!name) continue;
      named += 1;
      const domain = domainOf(item);
      if (domain) domains.add(domain);

      if (!SESSION_NAMES.includes(name)) continue;
      let value = String(item.value || "").trim();
      try {
        value = decodeURIComponent(value);
      } catch {
        /* keep raw */
      }
      if (!value) continue;
      if (domain.includes("labs.google")) {
        labsTokens.push(value);
      } else {
        otherTokens.push(value);
      }
    }

    const sessionToken =
      labsTokens.length > 0
        ? labsTokens[labsTokens.length - 1]
        : otherTokens.length > 0
          ? otherTokens[otherTokens.length - 1]
          : "";

    if (!sessionToken) {
      throw new Error(missingFlowTokenMessage([...domains], named));
    }
    return { session_token: sessionToken };
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

  if (text.includes("domain") && text.includes("name") && text.includes("value")) {
    throw new Error(
      "Có vẻ là cookie export nhưng không phải mảng JSON. " +
        "Cần dạng [ {\"domain\":\"labs.google\", \"name\":\"__Secure-next-auth.session-token\", ...} ]",
    );
  }

  throw new Error(
    "Dán JSON cookie labs.google (có __Secure-next-auth.session-token) hoặc session token (eyJ...)",
  );
}

export function parseMetaCookieInput(raw: string): string {
  const text = raw.trim();
  if (!text) {
    throw new Error("Chưa nhập cookie vibes.ai");
  }

  if (text.startsWith("[")) {
    let cookies: CookieItem[];
    try {
      cookies = JSON.parse(text) as CookieItem[];
    } catch {
      throw new Error("Cookie JSON không hợp lệ (không parse được mảng)");
    }
    if (!Array.isArray(cookies)) {
      throw new Error("Cookie JSON phải là mảng [ {...}, ... ]");
    }

    const parts = cookies
      .map((c) => {
        if (c.name && c.value) {
          return `${c.name}=${c.value}`;
        }
        return "";
      })
      .filter(Boolean);

    if (!parts.some((p) => p.startsWith("meta_session="))) {
      throw new Error("Cookie JSON thiếu meta_session (đăng nhập vibes.ai rồi export lại)");
    }
    return parts.join("; ");
  }

  if (text.includes("meta_session=")) {
    return text;
  }

  throw new Error("Cookie vibes.ai phải dạng JSON array hoặc chuỗi header chứa meta_session=...");
}
