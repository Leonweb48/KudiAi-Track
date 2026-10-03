import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import { formatWAT } from "../utils/wat";
import { fmtNaira } from "../utils/receiptPdfLayout";
import BarcodeScanner from "../components/BarcodeScanner";

/**
 * Public page at /verify — where the "Verify at kudiai.app/verify" line on a receipt
 * leads. Takes a transaction reference (KDT-YYYYMM-XXXXXXXX) and confirms it is real.
 *
 * Reached with no session (anyone holding a receipt can check it), so it only ever
 * shows non-identifying facts — the type of transaction, whether it went through
 * (successful / pending / failed / reversed), the amount, when it was recorded and by
 * which business — via the verify_receipt RPC, which deliberately returns no names,
 * balances or contact details.
 *
 * Also owners' report PDFs (2026-10-02): a KDR-YYYYMM-XXXXXXXX reference (printed with a QR in the report's footer) shows
 * the report type, business, period, when it was generated and the headline figures saved with it, so whoever holds the
 * PDF can check its figures were not changed.
 */
const REF_RE = /^KD[TR]-[0-9]{6}-[A-Z2-9]{8}$/;
const isReportRef = (ref) => String(ref || "").startsWith("KDR-");
const fmtDay = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "");
const FONT = "system-ui,-apple-system,'Segoe UI',sans-serif";
// How a KDR document reads, by verify_receipt's `doc`: its noun in sentences, the banner title, the label of its kind
// row, and who the stored name is (business_name) — the business behind a report / invoice, a statement's account holder.
const DOC_WORDS = {
  report:    { noun: "report",            title: "Report",            label: "Report",    holder: "Business" },
  statement: { noun: "statement",         title: "Statement",         label: "Statement", holder: "Account holder" },
  invoice:   { noun: "invoice",           title: "Invoice",           label: "Document",  holder: "Issued by" },
  receipt:   { noun: "receipt",           title: "Receipt",           label: "Document",  holder: "Issued by" },
  card:      { noun: "contribution card", title: "Contribution card", label: "Document",  holder: "Member" },
};

/**
 * The QR printed on a receipt (see receiptPdfLayout.js) encodes a full verify URL, but any 2D barcode
 * reader — including a generic phone camera app someone used instead of this page's own scanner — could
 * hand back just the bare reference. Handle both: pull ?ref= out of anything URL-shaped, else treat the
 * decoded text as the reference itself.
 */
export function refFromScan(text) {
  const raw = String(text || "").trim();
  try {
    const q = new URL(raw).searchParams.get("ref");
    if (q) return q;
  } catch { /* not a URL — fall through to treating it as a bare reference */ }
  return raw;
}

/**
 * How the page presents each status verify_receipt returns (migration 20270247). A receipt for a payment that failed, is
 * still pending or was reversed is real — but it is not proof of payment, so it must not read as a plain green "verified".
 * An answer with no status (a server from before the status existed) gets the old banner and no Status row.
 */
export const RECEIPT_STATUS = {
  successful: {
    label: "Successful", bg: "#f0fdf4", border: "#bbf7d0", ink: "#166534", dot: "#16a34a", pillBg: "#dcfce7",
    title: "Receipt verified", note: "This transaction was recorded on KudiAI Track and completed successfully.",
  },
  pending: {
    label: "Pending", bg: "#fffbeb", border: "#fde68a", ink: "#92400e", dot: "#d97706", pillBg: "#fef3c7",
    title: "Receipt found — payment pending", note: "This transaction is on KudiAI Track but hasn't completed yet. Don't treat it as paid until it shows Successful.",
  },
  failed: {
    label: "Failed", bg: "#fef2f2", border: "#fecaca", ink: "#991b1b", dot: "#dc2626", pillBg: "#fee2e2",
    title: "Receipt found — transaction failed", note: "This transaction is on KudiAI Track but it did not go through, so it is not proof of payment.",
  },
  reversed: {
    label: "Reversed", bg: "#f8fafc", border: "#e2e8f0", ink: "#334155", dot: "#64748b", pillBg: "#e2e8f0",
    title: "Receipt found — transaction reversed", note: "This transaction was reversed and the money returned, so it is not proof of payment.",
  },
};
const LEGACY_FOUND = { ...RECEIPT_STATUS.successful, note: "This transaction was recorded on KudiAI Track." };

function StatusIcon({ status, color }) {
  const stroke = { stroke: "#fff", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" };
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="11" fill={color} />
      {status === "pending" ? <path d="M12 6.5V12l3.5 2" {...stroke} />
        : status === "failed" ? <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" {...stroke} />
        : status === "reversed" ? <path d="M9 8.5L6 11.5l3 3M6.5 11.5h7a4 4 0 010 8H12" {...stroke} />
        : <path d="M7 12.5l3.2 3.2L17 9" {...stroke} />}
    </svg>
  );
}

function StatusPill({ look }) {
  return (
    <span data-testid="receipt-status" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: look.pillBg, color: look.ink, fontSize: 12, fontWeight: 700 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: look.dot }} />
      {look.label}
    </span>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: "1px solid #eef2f7" }}>
      <span style={{ color: "#64748b", fontSize: 13 }}>{label}</span>
      <span style={{ color: "#0f1c45", fontSize: 13, fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}

export default function VerifyReceipt() {
  const initial = (new URLSearchParams(window.location.search).get("ref") || "").trim().toUpperCase();
  const [ref, setRef] = useState(initial);
  const [state, setState] = useState({ status: "idle" });   // idle | checking | found | notfound | invalid | error

  const check = async (value) => {
    const clean = String(value || "").trim().toUpperCase();
    if (!REF_RE.test(clean)) { setState({ status: "invalid" }); return; }
    setState({ status: "checking" });
    try {
      const { data, error } = await supabase.rpc("verify_receipt", { p_ref: clean });
      if (error) throw error;
      setState(data?.found ? { status: "found", result: data, ref: clean } : { status: "notfound", ref: clean });
    } catch {
      setState({ status: "error" });
    }
  };

  // A receipt's link carries ?ref= — check it straight away.
  useEffect(() => { if (initial) check(initial); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = state.status === "checking";
  return (
    <div style={{ minHeight: "100dvh", background: "linear-gradient(160deg,#f0f4ff 0%,#fafafa 100%)", fontFamily: FONT, display: "flex", justifyContent: "center", padding: "32px 16px", boxSizing: "border-box" }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <img src="/logo-tp.png" alt="" width="34" height="34" style={{ borderRadius: 8 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <div>
            <div style={{ fontWeight: 800, color: "#0f1c45", fontSize: 16, lineHeight: 1.1 }}>KudiAI Track</div>
            <div style={{ color: "#64748b", fontSize: 11 }}>Amaya &amp; Co.</div>
          </div>
        </div>

        <div style={{ background: "#fff", borderRadius: 16, padding: 22, boxShadow: "0 1px 3px rgba(15,28,69,.08)", border: "1px solid #e2e8f0" }}>
          <h1 style={{ margin: "0 0 4px", fontSize: 20, color: "#0f1c45" }}>Verify a receipt or report</h1>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
            Enter the reference printed on the receipt or report — or scan its QR code — to confirm it was really issued by KudiAI Track.
          </p>

          <form onSubmit={(e) => { e.preventDefault(); check(ref); }}>
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value.toUpperCase())}
              placeholder="KDT-202609-X7K2M9PQ"
              autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              aria-label="Transaction reference"
              style={{ width: "100%", boxSizing: "border-box", padding: "13px 14px", fontSize: 15, fontFamily: "ui-monospace,Menlo,Consolas,monospace", letterSpacing: ".04em", border: "1px solid #cbd5e1", borderRadius: 10, outline: "none", color: "#0f1c45" }}
            />
            <button type="submit" disabled={busy || !ref.trim()}
              style={{ marginTop: 12, width: "100%", padding: "13px 16px", fontSize: 15, fontWeight: 700, color: "#fff", background: "#3DA829", border: 0, borderRadius: 10, cursor: busy ? "default" : "pointer", opacity: busy || !ref.trim() ? 0.6 : 1 }}>
              {busy ? "Checking…" : "Verify"}
            </button>
          </form>

          <BarcodeScanner onScan={(text) => { const r = refFromScan(text).toUpperCase(); setRef(r); check(r); }} />

          {state.status === "invalid" && (
            <p role="alert" style={{ margin: "14px 0 0", fontSize: 13, color: "#b45309" }}>
              That doesn't look like a KudiAI reference. Receipts start with KDT- (like KDT-202609-X7K2M9PQ), reports with KDR-.
            </p>
          )}
          {state.status === "error" && (
            <p role="alert" style={{ margin: "14px 0 0", fontSize: 13, color: "#b45309" }}>Couldn't check right now. Please try again in a moment.</p>
          )}
          {state.status === "notfound" && (
            <div role="alert" style={{ marginTop: 16, padding: 14, borderRadius: 12, background: "#fef2f2", border: "1px solid #fecaca" }}>
              <div style={{ fontWeight: 700, color: "#991b1b", fontSize: 14 }}>{isReportRef(state.ref) ? "No document found" : "No transaction found"}</div>
              <div style={{ color: "#7f1d1d", fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
                There is no {isReportRef(state.ref) ? "document" : "transaction"} with reference <b style={{ fontFamily: "ui-monospace,Menlo,Consolas,monospace" }}>{state.ref}</b>. Check the reference, and be cautious with a {isReportRef(state.ref) ? "document" : "receipt"} that cannot be verified.
              </div>
            </div>
          )}
          {state.status === "found" && state.result.is_report && (() => {
            const r = state.result;
            const period = r.period_from && r.period_to
              ? (String(r.period_from) === String(r.period_to) ? fmtDay(r.period_from) : `${fmtDay(r.period_from)} – ${fmtDay(r.period_to)}`)
              : "";
            const summary = Array.isArray(r.summary) ? r.summary.filter((x) => x && x.label) : [];
            // what the document is — report | statement | invoice | receipt | card (an older answer only says is_statement):
            // a statement is for an account holder, a contribution card for a member, an invoice / receipt is issued by a business
            const kind = DOC_WORDS[r.doc] ? r.doc : (r.is_statement ? "statement" : "report");
            const { noun: doc, title, label, holder } = DOC_WORDS[kind];
            return (
            <div style={{ marginTop: 16 }}>
              <div data-testid="report-banner" style={{ padding: 14, borderRadius: 12, background: RECEIPT_STATUS.successful.bg, border: `1px solid ${RECEIPT_STATUS.successful.border}`, display: "flex", gap: 10, alignItems: "center" }}>
                <StatusIcon status="successful" color={RECEIPT_STATUS.successful.dot} />
                <div>
                  <div style={{ fontWeight: 700, color: RECEIPT_STATUS.successful.ink, fontSize: 14 }}>{title} verified</div>
                  <div style={{ color: RECEIPT_STATUS.successful.ink, fontSize: 12, lineHeight: 1.45 }}>This {doc} was generated on KudiAI Track. Check that the figures below match the {doc} you were given.</div>
                </div>
              </div>
              <div style={{ marginTop: 6 }}>
                <Row label="Reference" value={<span style={{ fontFamily: "ui-monospace,Menlo,Consolas,monospace" }}>{state.ref}</span>} />
                <Row label={label} value={r.kind} />
                {r.business && <Row label={holder} value={r.business} />}
                {r.account_business && r.account_business !== r.business && <Row label="KudiAI account" value={r.account_business} />}
                {period && <Row label="Period" value={period} />}
                <Row label="Generated" value={formatWAT(r.occurred_at)} />
              </div>
              {summary.length > 0 && (
                <div data-testid="report-figures" style={{ marginTop: 14, padding: "4px 14px", borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em", padding: "10px 0 2px" }}>Figures on the {doc}</div>
                  {summary.map((x, i) => <Row key={i} label={x.label} value={x.value} />)}
                </div>
              )}
              <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "#94a3b8", lineHeight: 1.5 }}>
                If any of these differ from the PDF you have, the {doc} was changed after it was generated.
              </p>
            </div>
            );
          })()}
          {state.status === "found" && !state.result.is_report && (() => {
            const look = RECEIPT_STATUS[state.result.status];
            const banner = look || LEGACY_FOUND;
            return (
            <div style={{ marginTop: 16 }}>
              <div data-testid="receipt-banner" style={{ padding: 14, borderRadius: 12, background: banner.bg, border: `1px solid ${banner.border}`, display: "flex", gap: 10, alignItems: "center" }}>
                <StatusIcon status={look ? state.result.status : "successful"} color={banner.dot} />
                <div>
                  <div style={{ fontWeight: 700, color: banner.ink, fontSize: 14 }}>{banner.title}</div>
                  <div style={{ color: banner.ink, fontSize: 12, lineHeight: 1.45 }}>{banner.note}</div>
                </div>
              </div>
              <div style={{ marginTop: 6 }}>
                <Row label="Reference" value={<span style={{ fontFamily: "ui-monospace,Menlo,Consolas,monospace" }}>{state.ref}</span>} />
                <Row label="Transaction type" value={state.result.kind} />
                {look && <Row label="Status" value={<StatusPill look={look} />} />}
                <Row label="Amount" value={fmtNaira(state.result.amount)} />
                <Row label="Recorded" value={formatWAT(state.result.occurred_at)} />
                {state.result.business && <Row label="Business" value={state.result.business} />}
              </div>
              <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "#94a3b8", lineHeight: 1.5 }}>
                For privacy, names, balances and contact details are not shown here.
              </p>
            </div>
            );
          })()}
        </div>

        <p style={{ textAlign: "center", fontSize: 11, color: "#94a3b8", margin: "18px 0 0" }}>
          KudiAI Track · A product of Amaya &amp; Co. Technologies · support@kudiai.app
        </p>
      </div>
    </div>
  );
}
