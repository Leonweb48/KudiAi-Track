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
