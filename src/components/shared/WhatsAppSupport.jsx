// "Chat with us on WhatsApp" — opens KudiAI's business WhatsApp with a message already started (owner, 2026-10-25).
// A wa.me link: free, works on the web and in the Android app (WhatsApp, or WhatsApp Web without it). Until the
// WhatsApp assistant is built, a person answers these chats.
export const SUPPORT_WHATSAPP = "2347073998382";
export const SUPPORT_WHATSAPP_DISPLAY = "0707 399 8382";

/** The wa.me link to support, with `text` pre-filled (the customer can still edit it before sending). */
export function supportWhatsAppLink(text = "") {
  return `https://wa.me/${SUPPORT_WHATSAPP}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function openSupportWhatsApp(text = "") {
  try { window.open(supportWhatsAppLink(text), "_blank", "noopener"); } catch { /* ignore */ }
}

export function WhatsAppIcon({ className = "w-5 h-5" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.5 14.4c-.3-.1-1.8-.9-2-1s-.5-.1-.7.1-.8 1-1 1.2-.4.2-.7.1a8.2 8.2 0 01-4-3.5c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-1-2.2c-.2-.6-.5-.5-.7-.5h-.6a1.1 1.1 0 00-.8.4 3.4 3.4 0 00-1 2.5 6 6 0 001.2 3.1 13.4 13.4 0 005.2 4.6c1.9.8 2.7.9 3.6.7a3.1 3.1 0 002-1.4 2.5 2.5 0 00.2-1.4c-.1-.1-.3-.2-.6-.3zM12 21.8a9.9 9.9 0 01-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A9.8 9.8 0 1112 21.8zm0-21.6A11.8 11.8 0 002 18l-1.6 5.8 6-1.6A11.8 11.8 0 1012 .2z" />
    </svg>
  );
}

/** The green button. `message` is the pre-filled text; `label` the button text. */
export default function WhatsAppSupportButton({ message = "", label, className = "" }) {
  return (
    <button type="button" onClick={() => openSupportWhatsApp(message)}
      className={`flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1ebe5b] text-white font-bold text-sm px-4 py-2.5 rounded-2xl active:scale-95 transition ${className}`}>
      <WhatsAppIcon /> {label}
    </button>
  );
}
