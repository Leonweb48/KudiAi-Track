import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import { formatWAT } from "../utils/wat";
import { fmtNaira } from "../utils/receiptPdfLayout";

/**
 * Public page at /verify — where the "Verify at kudiai.app/verify" line on a receipt
 * leads. Takes a transaction reference (KDT-YYYYMM-XXXXXXXX) and confirms it is real.
 *
 * Reached with no session (anyone holding a receipt can check it), so it only ever
 * shows non-identifying facts — the kind of transaction, the amount, when it was
 * recorded and by which business — via the verify_receipt RPC, which deliberately
 * returns no names, balances or contact details.
 */
const REF_RE = /^KDT-[0-9]{6}-[A-Z2-9]{8}$/;
const FONT = "system-ui,-apple-system,'Segoe UI',sans-serif";

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
          <h1 style={{ margin: "0 0 4px", fontSize: 20, color: "#0f1c45" }}>Verify a receipt</h1>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
            Enter the transaction reference printed on the receipt to confirm it was really issued by KudiAI Track.
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

          {state.status === "invalid" && (
            <p role="alert" style={{ margin: "14px 0 0", fontSize: 13, color: "#b45309" }}>
              That doesn't look like a KudiAI reference. It starts with KDT- and looks like KDT-202609-X7K2M9PQ.
            </p>
          )}
          {state.status === "error" && (
            <p role="alert" style={{ margin: "14px 0 0", fontSize: 13, color: "#b45309" }}>Couldn't check right now. Please try again in a moment.</p>
          )}
          {state.status === "notfound" && (
            <div role="alert" style={{ marginTop: 16, padding: 14, borderRadius: 12, background: "#fef2f2", border: "1px solid #fecaca" }}>
              <div style={{ fontWeight: 700, color: "#991b1b", fontSize: 14 }}>No transaction found</div>
              <div style={{ color: "#7f1d1d", fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
                There is no transaction with reference <b style={{ fontFamily: "ui-monospace,Menlo,Consolas,monospace" }}>{state.ref}</b>. Check the reference, and be cautious with a receipt that cannot be verified.
              </div>
            </div>
          )}
          {state.status === "found" && (
            <div style={{ marginTop: 16 }}>
              <div style={{ padding: 14, borderRadius: 12, background: "#f0fdf4", border: "1px solid #bbf7d0", display: "flex", gap: 10, alignItems: "center" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#16a34a" /><path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <div>
                  <div style={{ fontWeight: 700, color: "#166534", fontSize: 14 }}>Receipt verified</div>
                  <div style={{ color: "#166534", fontSize: 12 }}>This transaction was recorded on KudiAI Track.</div>
                </div>
              </div>
              <div style={{ marginTop: 6 }}>
                <Row label="Reference" value={<span style={{ fontFamily: "ui-monospace,Menlo,Consolas,monospace" }}>{state.ref}</span>} />
                <Row label="Type" value={state.result.kind} />
                <Row label="Amount" value={fmtNaira(state.result.amount)} />
                <Row label="Recorded" value={formatWAT(state.result.occurred_at)} />
                {state.result.business && <Row label="Business" value={state.result.business} />}
              </div>
              <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "#94a3b8", lineHeight: 1.5 }}>
                For privacy, names, balances and contact details are not shown here.
              </p>
            </div>
          )}
        </div>

        <p style={{ textAlign: "center", fontSize: 11, color: "#94a3b8", margin: "18px 0 0" }}>
          KudiAI Track · A product of Amaya &amp; Co. Technologies · support@kudiai.app
        </p>
      </div>
    </div>
  );
}
