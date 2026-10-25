import DOMPurify from "dompurify";

// Legal documents, FAQ answers and consent text are HTML stored in the database and written from the admin portal.
// They are rendered with dangerouslySetInnerHTML, so a compromised admin account (or a future writable table) would
// otherwise be a stored-XSS hole in every user's session. Sanitising on the way out removes scripts, event handlers and
// javascript: URLs while keeping the formatting the content actually uses.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("target") === "_blank") node.setAttribute("rel", "noopener noreferrer");
});

export function sanitizeHtml(html) {
  return DOMPurify.sanitize(String(html ?? ""), {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed"],
  });
}

// Only ever open web links, phone links and mail links from data-driven URLs (ad campaigns, offers). A "javascript:" or
// "data:" URL passed to window.open would run script in the app's own origin.
export function safeExternalUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw, window.location.origin);
    return ["https:", "http:", "tel:", "mailto:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * A link to a file in OUR storage (payment proofs, chat media): https and our Supabase project or the kudiai.app/sb proxy
 * only — so a "proof" can't be a javascript: link run inside the owner's session, or a look-alike page opened in the app's
 * own browser window (2026-10-25 audit). null for anything else.
 */
export function safeStorageUrl(value) {
  const href = safeExternalUrl(value);
  if (!href) return null;
  try {
    const u = new URL(href);
    const sbHost = (() => { try { return new URL(process.env.REACT_APP_SUPABASE_URL || "").host; } catch { return ""; } })();
    const ours = u.protocol === "https:" && ((sbHost && u.host === sbHost && u.pathname.startsWith("/storage/"))
      || (u.host === "kudiai.app" && u.pathname.startsWith("/sb/storage/")));
    return ours ? u.href : null;
  } catch {
    return null;
  }
}
