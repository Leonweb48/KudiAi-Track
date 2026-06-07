/**
 * Professional PNG receipt cards — captured via html2canvas and shared
 * via the Web Share API (native sheet: WhatsApp, Telegram, etc.) or downloaded.
 */
import { useRef, useState } from "react";
import html2canvas from "html2canvas";

const fmt = (n) => `₦${Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
const YEAR = new Date().getFullYear();

/* ── PNG capture + share ─────────────────────────────────────────── */
async function captureCard(ref) {
  const canvas = await html2canvas(ref.current, {
    scale: 2.5,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
  });
  return new Promise((res) =>
    canvas.toBlob((blob) => res(new File([blob], "kuditrack-receipt.png", { type: "image/png" })), "image/png")
  );
}

async function shareFile(file) {
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: "KudiAI Track Receipt" });
  } else {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url; a.download = file.name; a.click();
    URL.revokeObjectURL(url);
  }
}

/* ── Receipt card building blocks (all inline styles → html2canvas safe) ── */

function ReceiptHeader({ gradient, badge, business, phone, date }) {
  return (
    <div style={{ background: gradient, padding: "22px 24px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        {/* Wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(255,255,255,0.22)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: "white", lineHeight: 1 }}>K</span>
          </div>
          <div style={{ lineHeight: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: "white",              letterSpacing: 0.5 }}>KUDI</span>
            <span style={{ fontSize: 13, fontWeight: 900, color: "rgba(255,255,255,.6)", letterSpacing: 0.5 }}>AI</span>
            <span style={{ fontSize: 9,  fontWeight: 700, color: "rgba(255,255,255,.5)", letterSpacing: 2.5, marginLeft: 4 }}>TRACK</span>
          </div>
        </div>
        {/* Badge */}
        <div style={{ background: "rgba(255,255,255,.2)", borderRadius: 99, padding: "3px 11px" }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: "white", letterSpacing: 1 }}>{badge}</span>
        </div>
      </div>
      <p style={{ fontSize: 18, fontWeight: 800, color: "white", margin: "0 0 5px", lineHeight: 1.25 }}>{business}</p>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {phone && <span style={{ fontSize: 11, color: "rgba(255,255,255,.65)", fontWeight: 500 }}>{phone}</span>}
        {date  && <span style={{ fontSize: 11, color: "rgba(255,255,255,.65)", fontWeight: 500 }}>{date}</span>}
      </div>
    </div>
  );
}

function Tear() {
  return (
    <div style={{ height: 24, background: "#eef2f7", position: "relative", display: "flex", alignItems: "center" }}>
      <div style={{ width: 20, height: 20, borderRadius: "0 10px 10px 0", background: "white", position: "absolute", left: 0 }} />
      <div style={{ flex: 1, borderTop: "2px dashed #cbd5e1", margin: "0 16px" }} />
      <div style={{ width: 20, height: 20, borderRadius: "10px 0 0 10px", background: "white", position: "absolute", right: 0 }} />
    </div>
  );
}

function AmountHero({ label, amount, color, badge, badgeColor }) {
  return (
    <div style={{ padding: "22px 24px 18px", textAlign: "center", background: "#f8fafc" }}>
      <p style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", letterSpacing: 2.5, textTransform: "uppercase", margin: "0 0 8px" }}>{label}</p>
      <p style={{ fontSize: 36, fontWeight: 900, color, margin: 0, letterSpacing: -0.5, lineHeight: 1 }}>{amount}</p>
      {badge && (
        <div style={{ display: "inline-block", marginTop: 10, background: badgeColor + "22", borderRadius: 99, padding: "4px 14px" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: badgeColor, letterSpacing: 0.8 }}>{badge}</span>
        </div>
      )}
    </div>
  );
}

function ProgressBar({ pct, paid, total }) {
  return (
    <div style={{ padding: "0 24px 14px", background: "#f8fafc" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>Paid {Math.round(pct)}%</span>
        <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>{fmt(paid)} of {fmt(total)}</span>
      </div>
      <div style={{ height: 6, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "#22c55e", borderRadius: 99 }} />
      </div>
    </div>
  );
}

function DataRow({ label, value, color, bold }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "9px 0", borderBottom: "1px solid #f1f5f9" }}>
      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", flexShrink: 0, marginRight: 12 }}>{label}</span>
      <span style={{ fontSize: 12, color: color || "#1e293b", fontWeight: bold ? 800 : 600, textAlign: "right", maxWidth: "58%", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

function ReceiptFooter({ gradient }) {
  return (
    <div style={{ background: gradient, padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 1, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 900, color: "white" }}>Kudi</span>
          <span style={{ fontSize: 14, fontWeight: 900, color: "rgba(255,255,255,.6)" }}>AI</span>
          <span style={{ fontSize: 9,  fontWeight: 700, color: "rgba(255,255,255,.5)", letterSpacing: 2, marginLeft: 4 }}>Track</span>
        </div>
        <p style={{ fontSize: 10, color: "rgba(255,255,255,.55)", margin: 0, fontWeight: 500 }}>
          © {YEAR} AMAYA &amp; Co. Technologies. All rights reserved.
        </p>
      </div>
      {/* Decorative barcode */}
      <div style={{ display: "flex", gap: 2, alignItems: "flex-end", opacity: 0.4 }}>
        {[14, 8, 18, 6, 16, 10, 18, 8, 14, 6, 16, 10].map((h, i) => (
          <div key={i} style={{ width: 2.5, height: h, background: "white", borderRadius: 1 }} />
        ))}
      </div>
    </div>
  );
}

/* ── Share buttons ───────────────────────────────────────────────── */
function ShareBar({ cardRef }) {
  const [busy, setBusy] = useState(false);

  const capture = async () => {
    setBusy(true);
    const file = await captureCard(cardRef);
    setBusy(false);
    return file;
  };

  const handleShare = async () => {
    const file = await capture();
    if (file) await shareFile(file);
  };

  const handleDownload = async () => {
    const file = await capture();
    if (file) {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a"); a.href = url; a.download = file.name; a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="flex gap-3 mt-6 w-full max-w-[340px] mx-auto">
      {/* WhatsApp */}
      <button onClick={handleShare} disabled={busy}
        title="Share to WhatsApp"
        className="flex-1 py-4 rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-60 shadow-md"
        style={{ background: "#25D366" }}>
        <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      </button>

      {/* Native share sheet */}
      <button onClick={handleShare} disabled={busy}
        title="Share"
        className="flex-1 py-4 rounded-2xl flex items-center justify-center bg-brand-600 hover:bg-brand-700 active:scale-95 transition disabled:opacity-60 shadow-md">
        <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" />
        </svg>
      </button>

      {/* Download PNG */}
      <button onClick={handleDownload} disabled={busy}
        title="Download PNG"
        className="flex-1 py-4 rounded-2xl flex items-center justify-center bg-slate-800 hover:bg-slate-700 active:scale-95 transition disabled:opacity-60 shadow-md">
        <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
        </svg>
      </button>
    </div>
  );
}

/* ── Full-screen receipt overlay ─────────────────────────────────── */
function ReceiptOverlay({ onClose, cardContent }) {
  const cardRef = useRef(null);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-start overflow-y-auto py-6 px-4"
      style={{ background: "rgba(10,10,20,0.88)", backdropFilter: "blur(8px)" }}>

      {/* Top bar */}
      <div className="flex items-center justify-between w-full max-w-[340px] mb-5">
        <p className="text-white font-bold text-sm tracking-wide opacity-80">Receipt Preview</p>
        <button onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition active:scale-95">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* The receipt card — captured as PNG */}
      <div ref={cardRef} style={{
        width: "100%", maxWidth: 340,
        background: "white",
        borderRadius: 20,
        overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
        fontFamily: "DM Sans, system-ui, -apple-system, sans-serif",
      }}>
        {cardContent}
      </div>

      {/* Share buttons */}
      <ShareBar cardRef={cardRef} />

      {/* Hint */}
      <p className="text-white/30 text-xs mt-4 text-center pb-4">
        Tap an icon to share or download as PNG
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TRANSACTION RECEIPT
═══════════════════════════════════════════════════════════════════ */
export function TransactionReceipt({ txn, profile, onClose }) {
  const isIn = txn.type === "in";
  const biz  = profile.business_name || profile.owner_name || "My Business";
  const gradient = isIn
    ? "linear-gradient(135deg,#059669 0%,#047857 60%,#065f46 100%)"
    : "linear-gradient(135deg,#ef4444 0%,#dc2626 60%,#b91c1c 100%)";
  const amtColor = isIn ? "#059669" : "#dc2626";

  const cardContent = (
    <>
      <ReceiptHeader
        gradient={gradient}
        badge="RECEIPT"
        business={biz}
        phone={profile.phone}
        date={txn.transaction_date}
      />
      <Tear />
      <AmountHero
        label={isIn ? "Cash In" : "Cash Out"}
        amount={fmt(txn.amount)}
        color={amtColor}
        badge={isIn ? "● CREDIT" : "● DEBIT"}
        badgeColor={amtColor}
      />
      <Tear />
      <div style={{ padding: "6px 24px 6px" }}>
        <DataRow label="Item"     value={txn.item_name}    bold />
        <DataRow label="Category" value={txn.category} />
        {txn.quantity > 1 && <DataRow label="Qty" value={txn.quantity} />}
        <DataRow label="Payment"  value={txn.payment_type} />
        <DataRow label="Customer" value={txn.customer_name} />
        <DataRow label="Note"     value={txn.note} />
        <DataRow label="Date"     value={txn.transaction_date} />
      </div>
      <ReceiptFooter gradient={gradient} />
    </>
  );

  return <ReceiptOverlay onClose={onClose} cardContent={cardContent} />;
}

/* ═══════════════════════════════════════════════════════════════════
   CREDIT STATEMENT
═══════════════════════════════════════════════════════════════════ */
export function CreditReceipt({ credit, profile, onClose }) {
  const biz  = profile.business_name || profile.owner_name || "My Business";
  const gradient = "linear-gradient(135deg,#f59e0b 0%,#d97706 60%,#b45309 100%)";
  const pct  = Math.min(100, ((credit.amount_paid || 0) / (credit.total_amount || 1)) * 100);

  const statusColors = { paid: "#22c55e", active: "#f59e0b", partially_paid: "#f59e0b", overdue: "#ef4444" };
  const badgeColor = statusColors[credit.status] || "#f59e0b";

  const cardContent = (
    <>
      <ReceiptHeader
        gradient={gradient}
        badge="CREDIT STATEMENT"
        business={biz}
        phone={profile.phone}
        date={credit.date_given}
      />
      <Tear />
      <AmountHero
        label="Outstanding Balance"
        amount={fmt(credit.outstanding)}
        color="#d97706"
        badge={(credit.status || "active").replace("_", " ").toUpperCase()}
        badgeColor={badgeColor}
      />
      <ProgressBar pct={pct} paid={credit.amount_paid} total={credit.total_amount} />
      <Tear />
      <div style={{ padding: "6px 24px 6px" }}>
        <DataRow label="Customer"    value={credit.customer_name} bold />
        <DataRow label="Phone"       value={credit.phone} />
        <DataRow label="Total Owed"  value={fmt(credit.total_amount)} />
        <DataRow label="Amount Paid" value={fmt(credit.amount_paid)}  color="#22c55e" />
        <DataRow label="Outstanding" value={fmt(credit.outstanding)}  color="#d97706" bold />
        <DataRow label="Date Given"  value={credit.date_given} />
        <DataRow label="Due Date"    value={credit.due_date} />
        <DataRow label="Notes"       value={credit.notes} />
      </div>
      <ReceiptFooter gradient={gradient} />
    </>
  );

  return <ReceiptOverlay onClose={onClose} cardContent={cardContent} />;
}

/* ═══════════════════════════════════════════════════════════════════
   ASO SAVINGS STATEMENT
═══════════════════════════════════════════════════════════════════ */
export function AsoReceipt({ client, profile, onClose }) {
  const biz  = profile.business_name || profile.owner_name || "My Business";
  const gradient = "linear-gradient(135deg,#7c3aed 0%,#5b21b6 60%,#4c1d95 100%)";

  const cardContent = (
    <>
      <ReceiptHeader
        gradient={gradient}
        badge="ASO STATEMENT"
        business={biz}
        phone={profile.phone}
        date={new Date().toISOString().slice(0, 10)}
      />
      <Tear />
      <AmountHero
        label="Current Balance"
        amount={fmt(client.current_balance)}
        color="#7c3aed"
        badge={(client.status || "active").toUpperCase()}
        badgeColor="#7c3aed"
      />
      <Tear />
      <div style={{ padding: "6px 24px 6px" }}>
        <DataRow label="Client"      value={client.full_name}   bold />
        <DataRow label="Phone"       value={client.phone} />
        <DataRow label="Total Saved" value={fmt(client.total_saved)}    color="#22c55e" bold />
        <DataRow label="Withdrawn"   value={fmt(client.total_withdrawn)} color="#ef4444" />
        <DataRow label="Balance"     value={fmt(client.current_balance)} color="#7c3aed" bold />
        <DataRow label="Frequency"   value={client.contribution_frequency} />
        <DataRow label="Contribution" value={fmt(client.contribution_amount)} />
        <DataRow label="Next Due"    value={client.next_contribution_date} />
        <DataRow label="Registered"  value={client.registration_date} />
        <DataRow label="Notes"       value={client.notes} />
      </div>
      <ReceiptFooter gradient={gradient} />
    </>
  );

  return <ReceiptOverlay onClose={onClose} cardContent={cardContent} />;
}
