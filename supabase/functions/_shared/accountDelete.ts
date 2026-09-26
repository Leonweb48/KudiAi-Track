// Pure helpers for the account-delete edge function (kept here so they can be unit-tested without a server).

/** "https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path>" → { bucket: [path, …] }. Only OUR project's storage URLs; anything else is ignored. */
export function storageTargets(urls: unknown[], supabaseUrl: string): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  let origin = "";
  try { origin = new URL(supabaseUrl).origin; } catch { return {}; }
  for (const raw of urls || []) {
    if (typeof raw !== "string" || !raw) continue;
    try {
      const u = new URL(raw);
      if (u.origin !== origin) continue;
      const m = u.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
      if (!m) continue;
      const path = decodeURIComponent(m[2]);
      if (!path || path.includes("..")) continue;
      (out[m[1]] ||= new Set()).add(path);
    } catch { /* not a URL */ }
  }
  return Object.fromEntries(Object.entries(out).map(([b, s]) => [b, [...s]]));
}

export function validEmail(s: unknown): s is string {
  return typeof s === "string" && s.length <= 200 && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(s.trim());
}

/** Trim, drop control characters, cap the length. */
export function cleanText(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  // deno-lint-ignore no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

/** The caller's IP. Prefer the edge proxy's own header; otherwise the LAST forwarded hop (the first can be supplied by the caller). */
export function clientIp(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim().slice(0, 64);
  const xff = (headers.get("x-forwarded-for") || "").split(",").map((p) => p.trim()).filter(Boolean);
  return (xff[xff.length - 1] || "unknown").slice(0, 64);
}
