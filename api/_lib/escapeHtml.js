// Shared HTML-escaping helpers for every email template in this repo.
//
// Files under api/ that start with "_" are not deployed as functions, so this
// module costs nothing against the platform's function limit.
//
// Strategy used by api/email-trigger.js:
//   1. escapeDeep() the whole request payload ONCE at the door, so every
//      interpolation of `d.<anything>` — including inside nested fragments and
//      helper functions — is already safe. Nothing user-supplied can reach the
//      HTML unescaped, and a template author cannot forget a call.
//   2. Values that go somewhere other than HTML (the To: address, the Subject:
//      line, attachment filenames) are decoded back with decodeEntities() at
//      the SMTP boundary, because escaping is only correct for HTML.

const MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape a value for safe interpolation into HTML text or a quoted attribute. */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => MAP[c]);
}

/** Escape every string inside a payload (objects and arrays included). */
export function escapeDeep(value) {
  if (typeof value === "string") return escapeHtml(value);
  if (Array.isArray(value)) return value.map(escapeDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = escapeDeep(v);
    return out;
  }
  return value;
}

/** Reverse escapeHtml() — for plain-text destinations (recipient, subject, filename). */
export function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");   // last, so "&amp;lt;" decodes once to "&lt;", not to "<"
}

/** A subject line: plain text, single line, bounded length (no header injection). */
// Control characters (CR, LF, NUL, …) would allow header injection — they become spaces.
const CONTROL_CHARS = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]+", "g");

export function cleanSubject(value) {
  return decodeEntities(value).replace(CONTROL_CHARS, " ").replace(/ {2,}/g, " ").trim().slice(0, 200);
}
