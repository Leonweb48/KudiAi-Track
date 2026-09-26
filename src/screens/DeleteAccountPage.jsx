import { useState } from "react";
import { callAccountDelete } from "../utils/accountDeletion";

/**
 * Public page at /delete-account — the "account deletion URL" Google Play asks for (Data safety → Data deletion).
 * Reached with no session. Explains how to delete in the app, what has to be settled first, what is erased and what is kept,
 * and gives people who can no longer sign in a form to ask us to do it (recorded server-side for the team to verify and action).
 */
const FONT = "system-ui,-apple-system,'Segoe UI',sans-serif";
const NAVY = "#0f1c45";

const card = { background: "#fff", borderRadius: 16, padding: 22, boxShadow: "0 1px 3px rgba(15,28,69,.08)", border: "1px solid #e2e8f0", marginBottom: 16 };
const h2 = { margin: "0 0 8px", fontSize: 16, fontWeight: 800, color: NAVY };
const p = { margin: "0 0 10px", fontSize: 14, color: "#334155", lineHeight: 1.55 };
const ul = { margin: "0 0 10px", paddingLeft: 22, listStyleType: "disc", fontSize: 14, color: "#334155", lineHeight: 1.6 };
const input = { width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 12, padding: "11px 13px", fontSize: 14, fontFamily: FONT, color: NAVY, background: "#fff" };
const label = { display: "block", fontSize: 12, fontWeight: 700, color: "#64748b", margin: "12px 0 5px" };

export default function DeleteAccountPage() {
  const [form, setForm] = useState({ email: "", full_name: "", phone: "", note: "", website: "" });   // `website` is a honeypot
  const [state, setState] = useState({ status: "idle", error: "" });                                 // idle | sending | sent | error
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (state.status === "sending") return;
    setState({ status: "sending", error: "" });
    const r = await callAccountDelete({ action: "request", ...form });
    if (r.ok) setState({ status: "sent", error: "" });
    else setState({ status: "error", error: r.data?.error || "We could not send your request. Please email support@kudiai.app." });
  };

  return (
    <div style={{ minHeight: "100dvh", background: "linear-gradient(160deg,#f0f4ff 0%,#fafafa 100%)", fontFamily: FONT, display: "flex", justifyContent: "center", padding: "32px 16px", boxSizing: "border-box" }}>
      <div style={{ width: "100%", maxWidth: 560 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <img src="/logo-tp.png" alt="" width="34" height="34" style={{ borderRadius: 8 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <div>
            <div style={{ fontWeight: 800, color: NAVY, fontSize: 16, lineHeight: 1.1 }}>KudiAI Track</div>
            <div style={{ color: "#64748b", fontSize: 11 }}>Amaya &amp; Co. Technologies</div>
          </div>
        </div>

        <h1 style={{ margin: "0 0 6px", fontSize: 24, fontWeight: 800, color: NAVY }}>Delete your KudiAI Track account</h1>
        <p style={{ ...p, color: "#64748b" }}>
          You can delete your account and erase your personal data yourself, in the app, in about a minute. If you can no longer sign in, ask us below.
        </p>

        <div style={card}>
          <h2 style={h2}>Delete it in the app</h2>
          <ol style={{ ...ul, listStyleType: "decimal" }}>
            <li><b>Business owners:</b> open <b>Settings</b>, scroll to the bottom and tap <b>Delete my account</b>.</li>
            <li><b>Staff and managers:</b> open <b>Me</b> and tap <b>Delete my account</b> under Sign Out.</li>
            <li><b>Savings (Ajo / Esusu) clients:</b> open <b>Settings</b> and tap <b>Delete my account</b> under Sign Out.</li>
            <li><b>Cooperative members:</b> open the side menu and tap <b>Delete my account</b> under Sign out.</li>
          </ol>
          <p style={p}>You confirm with your password. Your account is deleted straight away and you are signed out.</p>
        </div>

        <div style={card}>
          <h2 style={h2}>What must be settled first</h2>
          <p style={p}>To protect your money and other people’s records, an account can only be deleted when nothing is left open:</p>
          <ul style={ul}>
            <li>Your wallet balance is ₦0 — transfer it to your bank account first.</li>
            <li>No transfer or bill payment is still being processed.</li>
            <li>No savings balance, active savings card, savings group or cooperative loan.</li>
            <li>Business owners: no active staff accounts, no active Ajo clients holding savings, and no cooperative still running.</li>
          </ul>
          <p style={p}>The app shows you exactly what is still open and what to do about it.</p>
        </div>

        <div style={card}>
          <h2 style={h2}>What is erased, and what we keep</h2>
          <p style={{ ...p, marginBottom: 4 }}><b>Erased:</b></p>
          <ul style={ul}>
            <li>Your name, phone number, email address, address and photos.</li>
            <li>Your PINs, saved bank details and identity numbers (such as NIN).</li>
            <li>Business owners: the names, phone numbers and addresses of the customers, debtors and clients in your books.</li>
            <li>Your notifications, devices and sign-in.</li>
          </ul>
          <p style={{ ...p, marginBottom: 4 }}><b>Kept, without your identity:</b></p>
          <ul style={ul}>
            <li>A record of financial transactions — amounts, dates and references — and the identity-verification records that financial regulations require us to hold. This is kept for up to 7 years and is no longer linked to your name.</li>
          </ul>
          <p style={p}><b>Important:</b> after deleting, do not send money to your old KudiAI wallet account number. Money sent to it cannot be reached from the app; contact support if it happens.</p>
        </div>

        <div style={card}>
          <h2 style={h2}>Can’t sign in? Ask us to delete it</h2>
          {state.status === "sent" ? (
            <div role="status" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: 14, color: "#166534", fontSize: 14, lineHeight: 1.5 }}>
              <b>Request received.</b> We will email you to confirm it is really you, then delete the account within 30 days. If you still have money in your wallet, we will help you withdraw it first.
            </div>
          ) : (
            <form onSubmit={submit}>
              <p style={p}>Use the email address you signed up with. We will reply to that address to confirm it is you before anything is deleted.</p>
              <label style={label} htmlFor="da-email">Email address *</label>
              <input id="da-email" type="email" required maxLength={200} value={form.email} onChange={set("email")} style={input} autoComplete="email" />
              <label style={label} htmlFor="da-name">Full name (optional)</label>
              <input id="da-name" type="text" maxLength={120} value={form.full_name} onChange={set("full_name")} style={input} autoComplete="name" />
              <label style={label} htmlFor="da-phone">Phone number on the account (optional)</label>
              <input id="da-phone" type="tel" maxLength={40} value={form.phone} onChange={set("phone")} style={input} autoComplete="tel" />
              <label style={label} htmlFor="da-note">Anything we should know (optional)</label>
              <textarea id="da-note" maxLength={1000} rows={3} value={form.note} onChange={set("note")} style={{ ...input, resize: "vertical" }} />
              {/* honeypot — hidden from people, filled in by bots */}
              <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
                <label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} /></label>
              </div>
              {state.status === "error" && <p role="alert" style={{ ...p, color: "#b91c1c", marginTop: 12 }}>{state.error}</p>}
              <button
                type="submit" disabled={state.status === "sending" || !form.email}
                style={{ marginTop: 16, width: "100%", background: "#3DA829", color: "#fff", border: 0, borderRadius: 12, padding: "13px 16px", fontSize: 15, fontWeight: 700, fontFamily: FONT, opacity: state.status === "sending" || !form.email ? 0.6 : 1, cursor: "pointer" }}
              >
                {state.status === "sending" ? "Sending…" : "Request account deletion"}
              </button>
            </form>
          )}
        </div>

        <p style={{ ...p, textAlign: "center", color: "#64748b", fontSize: 12 }}>
          Questions? <a href="mailto:support@kudiai.app" style={{ color: NAVY }}>support@kudiai.app</a> · <a href="/privacy" style={{ color: NAVY }}>Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}
