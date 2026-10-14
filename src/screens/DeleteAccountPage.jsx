import { useState } from "react";
import { callAccountDelete } from "../utils/accountDeletion";
import { useT } from "../contexts/LanguageContext";

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
// Translated text marks bold words as **word**
const rich = (text) => String(text).split(/\*\*(.+?)\*\*/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));

export default function DeleteAccountPage() {
  const t = useT();
  const [form, setForm] = useState({ email: "", full_name: "", phone: "", note: "", website: "" });   // `website` is a honeypot
  const [state, setState] = useState({ status: "idle", error: "" });                                 // idle | sending | sent | error
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (state.status === "sending") return;
    setState({ status: "sending", error: "" });
    const r = await callAccountDelete({ action: "request", ...form });
    if (r.ok) setState({ status: "sent", error: "" });
    else setState({ status: "error", error: r.data?.error || t("circles.del.errSend") });
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

        <h1 style={{ margin: "0 0 6px", fontSize: 24, fontWeight: 800, color: NAVY }}>{t("circles.del.title")}</h1>
        <p style={{ ...p, color: "#64748b" }}>
          {t("circles.del.intro")}
        </p>

        <div style={card}>
          <h2 style={h2}>{t("circles.del.inAppTitle")}</h2>
          <ol style={{ ...ul, listStyleType: "decimal" }}>
            <li>{rich(t("circles.del.stepOwner"))}</li>
            <li>{rich(t("circles.del.stepStaff"))}</li>
            <li>{rich(t("circles.del.stepClient"))}</li>
            <li>{rich(t("circles.del.stepCoop"))}</li>
          </ol>
          <p style={p}>{t("circles.del.confirmPw")}</p>
        </div>

        <div style={card}>
          <h2 style={h2}>{t("circles.del.settleTitle")}</h2>
          <p style={p}>{t("circles.del.settleIntro")}</p>
          <ul style={ul}>
            <li>{t("circles.del.settle1")}</li>
            <li>{t("circles.del.settle2")}</li>
            <li>{t("circles.del.settle3")}</li>
            <li>{t("circles.del.settle4")}</li>
          </ul>
          <p style={p}>{t("circles.del.settleOutro")}</p>
        </div>

        <div style={card}>
          <h2 style={h2}>{t("circles.del.erasedTitle")}</h2>
          <p style={{ ...p, marginBottom: 4 }}><b>{t("circles.del.erased")}</b></p>
          <ul style={ul}>
            <li>{t("circles.del.erased1")}</li>
            <li>{t("circles.del.erased2")}</li>
            <li>{t("circles.del.erased3")}</li>
            <li>{t("circles.del.erased4")}</li>
          </ul>
          <p style={{ ...p, marginBottom: 4 }}><b>{t("circles.del.kept")}</b></p>
          <ul style={ul}>
            <li>{t("circles.del.kept1")}</li>
          </ul>
          <p style={p}>{rich(t("circles.del.important"))}</p>
        </div>

        <div style={card}>
          <h2 style={h2}>{t("circles.del.askTitle")}</h2>
          {state.status === "sent" ? (
            <div role="status" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: 14, color: "#166534", fontSize: 14, lineHeight: 1.5 }}>
              {rich(t("circles.del.received"))}
            </div>
          ) : (
            <form onSubmit={submit}>
              <p style={p}>{t("circles.del.formIntro")}</p>
              <label style={label} htmlFor="da-email">{t("circles.del.email")}</label>
              <input id="da-email" type="email" required maxLength={200} value={form.email} onChange={set("email")} style={input} autoComplete="email" />
              <label style={label} htmlFor="da-name">{t("circles.del.fullName")}</label>
              <input id="da-name" type="text" maxLength={120} value={form.full_name} onChange={set("full_name")} style={input} autoComplete="name" />
              <label style={label} htmlFor="da-phone">{t("circles.del.phone")}</label>
              <input id="da-phone" type="tel" maxLength={40} value={form.phone} onChange={set("phone")} style={input} autoComplete="tel" />
              <label style={label} htmlFor="da-note">{t("circles.del.note")}</label>
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
                {state.status === "sending" ? t("circles.del.sending") : t("circles.del.request")}
              </button>
            </form>
          )}
        </div>

        <p style={{ ...p, textAlign: "center", color: "#64748b", fontSize: 12 }}>
          {t("circles.del.questions")} <a href="mailto:support@kudiai.app" style={{ color: NAVY }}>support@kudiai.app</a> · <a href="/privacy" style={{ color: NAVY }}>{t("circles.del.privacy")}</a>
        </p>
      </div>
    </div>
  );
}
