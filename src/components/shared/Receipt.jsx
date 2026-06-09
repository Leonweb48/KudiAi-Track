/**
 * Professional banking-style receipts.
 * Logo left · Transaction title + date right · Navy + green palette.
 * Captured via html2canvas → PDF download or shared as PNG via Web Share API.
 */
import { useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF }   from "jspdf";

const fmt  = (n) => `₦${Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
const NAVY = "#1B2A5E";
const NAV2 = "#0F1D42";
const GRN  = "#16a34a";
const GRN2 = "#22c55e";
const YEAR = new Date().getFullYear();
const SUPPORT_EMAIL = "support@kudiaitrack.biz";

const refNo = (id) =>
  id ? `KT-${id.toString().replace(/-/g, "").slice(0, 8).toUpperCase()}`
     : `KT-${Date.now().toString(36).toUpperCase().slice(-8)}`;

/* ── Canvas capture helper ───────────────────────────────────────── */
async function captureCanvas(ref) {
  await new Promise((r) => setTimeout(r, 120));
  return html2canvas(ref.current, {
    scale: 2.5, useCORS: true, allowTaint: false,
    backgroundColor: "#ffffff", logging: false, imageTimeout: 10000,
  });
}

async function captureFile(ref) {
  const canvas = await captureCanvas(ref);
  return new Promise((res) =>
    canvas.toBlob(
      (blob) => res(new File([blob], "kuditrack-receipt.png", { type: "image/png" })),
      "image/png"
    )
  );
}

async function downloadPDF(ref, filename) {
  const canvas  = await captureCanvas(ref);
  const imgData = canvas.toDataURL("image/png");
  // Size PDF to match the receipt card (px → mm at 96dpi)
  const mmW = (canvas.width  / 2.5) * (25.4 / 96);
  const mmH = (canvas.height / 2.5) * (25.4 / 96);
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: [mmW, mmH] });
  pdf.addImage(imgData, "PNG", 0, 0, mmW, mmH);
  pdf.save(filename || "KudiAITrack_Receipt.pdf");
}

async function nativeShare(file) {
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: "KudiAI Track Receipt" });
  } else {
    const url = URL.createObjectURL(file);
    const a   = document.createElement("a");
    a.href = url; a.download = file.name; a.click();
    URL.revokeObjectURL(url);
  }
}

/* ══════════════════════════════════════════════════════════════════
   RECEIPT BUILDING BLOCKS  (all inline styles for html2canvas)
══════════════════════════════════════════════════════════════════ */

/* ── Header: logo left, title + date right ── */
function Header({ title, business, email, date, id }) {
  return (
    <>
      {/* Navy band */}
      <div style={{
        background: `linear-gradient(135deg, ${NAVY} 0%, ${NAV2} 100%)`,
        padding: "20px 22px 18px",
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      }}>
        {/* Logo */}
        <img
          src="/logo.png" alt="KudiAI Track" crossOrigin="anonymous"
          style={{ height: 52, width: "auto", objectFit: "contain", flexShrink: 0 }}
        />
        {/* Right column */}
        <div style={{ textAlign: "right", marginLeft: 12 }}>
          <p style={{ fontSize: 15, fontWeight: 900, color: "white", margin: "0 0 4px", letterSpacing: 0.2, lineHeight: 1.1 }}>
            {title}
          </p>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", margin: "0 0 2px", fontWeight: 500 }}>
            {business}
          </p>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", margin: "0 0 2px" }}>
            {email || SUPPORT_EMAIL}
          </p>
          <p style={{ fontSize: 10, color: GRN2, fontWeight: 700, margin: 0 }}>{date}</p>
        </div>
      </div>

      {/* Green accent stripe */}
      <div style={{ height: 4, background: `linear-gradient(90deg, ${GRN} 0%, ${GRN2} 100%)` }} />

      {/* Reference bar */}
      <div style={{ background: "#f0fdf4", padding: "7px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#6b7280", fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase" }}>Ref No.</span>
        <span style={{ fontSize: 11, color: GRN, fontWeight: 900, letterSpacing: 1.5 }}>{refNo(id)}</span>
      </div>
    </>
  );
}

/* ── Amount hero ── */
function AmountHero({ label, amount, color, badge, badgeColor }) {
  return (
    <div style={{ textAlign: "center", padding: "24px 22px 20px", background: "white", borderBottom: `2px solid ${color}20` }}>
      <p style={{ fontSize: 10, fontWeight: 800, color: "#9ca3af", letterSpacing: 2.5, textTransform: "uppercase", margin: "0 0 10px" }}>
        {label}
      </p>
      <p style={{ fontSize: 40, fontWeight: 900, color, margin: 0, letterSpacing: -1, lineHeight: 1 }}>{amount}</p>
      {badge && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 12, background: `${badgeColor}15`, borderRadius: 99, padding: "5px 16px" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: badgeColor }} />
          <span style={{ fontSize: 11, fontWeight: 800, color: badgeColor, letterSpacing: 1 }}>{badge}</span>
        </div>
      )}
    </div>
  );
}

/* ── Progress (credit) ── */
function Progress({ pct, paid, total }) {
  return (
    <div style={{ padding: "14px 22px 16px", background: "#fafafa", borderBottom: "1px solid #e5e7eb" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#6b7280", fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase" }}>Repayment</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: GRN }}>{Math.round(pct)}% paid</span>
      </div>
      <div style={{ height: 7, background: "#e5e7eb", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg,${GRN},${GRN2})`, borderRadius: 99 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <span style={{ fontSize: 10, color: GRN,     fontWeight: 600 }}>Paid: {fmt(paid)}</span>
        <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600 }}>Total: {fmt(total)}</span>
      </div>
    </div>
  );
}

/* ── Thin divider ── */
function Sep() {
  return <div style={{ height: 1, background: "#e5e7eb", margin: "0 22px" }} />;
}

/* ── Data section header ── */
function SectionHead({ label }) {
  return (
    <div style={{ padding: "12px 22px 6px", background: "#f9fafb" }}>
      <span style={{ fontSize: 9, fontWeight: 800, color: NAVY, letterSpacing: 2, textTransform: "uppercase" }}>{label}</span>
    </div>
  );
}

/* ── Data row ── */
function Row({ label, value, color, bold, last }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      padding: "10px 22px",
      borderBottom: last ? "none" : "1px solid #f3f4f6",
      background: "white",
    }}>
      <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", flexShrink: 0, marginRight: 10, paddingTop: 1 }}>
        {label}
      </span>
      <span style={{ fontSize: 12, color: color || NAVY, fontWeight: bold ? 800 : 600, textAlign: "right", maxWidth: "64%", wordBreak: "break-word", lineHeight: 1.4 }}>
        {value}
      </span>
    </div>
  );
}

/* ── Footer ── */
function Footer() {
  return (
    <div style={{ background: NAVY, padding: "16px 22px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 800, color: GRN2, margin: "0 0 4px", letterSpacing: 0.2 }}>
            AMAYA &amp; Co. Technologies
          </p>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", margin: 0 }}>
            Copyright @{YEAR}. All Rights Reserved.
          </p>
        </div>
        {/* Barcode accent */}
        <div style={{ display: "flex", gap: 2, alignItems: "flex-end", opacity: 0.3 }}>
          {[12, 7, 16, 5, 14, 9, 18, 6, 12, 5, 16].map((h, i) => (
            <div key={i} style={{ width: 2.5, height: h, background: "white", borderRadius: 1 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SHARE BUTTONS
══════════════════════════════════════════════════════════════════ */
function ShareButtons({ cardRef, pdfName }) {
  const [busy, setBusy] = useState(false);

  const run = async (fn) => {
    setBusy(true);
    try   { await fn(); }
    catch { /* silently ignore */ }
    finally { setBusy(false); }
  };

  const onShare   = () => run(async () => { const f = await captureFile(cardRef); await nativeShare(f); });
  const onSavePDF = () => run(() => downloadPDF(cardRef, pdfName));

  const Btn = ({ onClick, bg, children, title }) => (
    <button onClick={onClick} disabled={busy} title={title}
      className="flex-1 py-4 rounded-2xl flex items-center justify-center active:scale-95 transition-transform disabled:opacity-60 shadow-lg"
      style={{ background: bg }}>
      {busy
        ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        : children
      }
    </button>
  );

  return (
    <div className="flex gap-3 mt-6 w-full max-w-[340px] mx-auto">
      {/* WhatsApp */}
      <Btn onClick={onShare} bg="#25D366" title="Share to WhatsApp">
        <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      </Btn>

      {/* Native share */}
      <Btn onClick={onShare} bg={NAVY} title="Share">
        <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
        </svg>
      </Btn>

      {/* Save PDF */}
      <Btn onClick={onSavePDF} bg={GRN} title="Save as PDF">
        <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
      </Btn>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   FULL-SCREEN OVERLAY
══════════════════════════════════════════════════════════════════ */
function Overlay({ onClose, pdfName, children }) {
  const cardRef = useRef(null);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-start overflow-y-auto py-6 px-4"
      style={{ background: "rgba(8,12,30,0.94)", backdropFilter: "blur(12px)" }}>

      {/* Top bar */}
      <div className="flex items-center justify-between w-full max-w-[340px] mb-5">
        <span className="text-white/40 text-[10px] font-bold tracking-[3px] uppercase">Receipt Preview</span>
        <button onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition active:scale-95">
          <svg viewBox="0 0 24 24" fill="none" className="w-4.5 h-4.5 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Card (captured for export) */}
      <div ref={cardRef} style={{
        width: "100%", maxWidth: 340,
        background: "white",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 40px 100px rgba(0,0,0,0.6)",
        fontFamily: "DM Sans, system-ui, -apple-system, sans-serif",
      }}>
        {children}
      </div>

      <ShareButtons cardRef={cardRef} pdfName={pdfName} />
      <p className="text-white/20 text-xs mt-4 pb-4">WhatsApp · Share · Save PDF</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TRANSACTION RECEIPT
══════════════════════════════════════════════════════════════════ */
export function TransactionReceipt({ txn, profile, onClose }) {
  const isIn = txn.type === "in";
  const biz  = profile.business_name || profile.owner_name || "My Business";
  const amtColor   = isIn ? GRN : "#dc2626";
  const badgeColor = amtColor;

  return (
    <Overlay onClose={onClose} pdfName={`KudiAITrack_${isIn ? "CashIn" : "CashOut"}_Receipt_${txn.transaction_date || "today"}.pdf`}>
      <Header
        title={isIn ? "CASH IN RECEIPT" : "CASH OUT RECEIPT"}
        business={biz}
        email={SUPPORT_EMAIL}
        date={txn.transaction_date}
        id={txn.id}
      />

      <AmountHero
        label="Transaction Amount"
        amount={fmt(txn.amount)}
        color={amtColor}
        badge={isIn ? "CREDIT" : "DEBIT"}
        badgeColor={badgeColor}
      />

      <SectionHead label="Transaction Details" />
      <Row label="Item"      value={txn.item_name}     bold />
      <Row label="Category"  value={txn.category} />
      {txn.quantity > 1 && <Row label="Quantity" value={txn.quantity} />}
      <Row label="Payment"   value={txn.payment_type} />
      <Row label="Customer"  value={txn.customer_name} />
      <Row label="Note"      value={txn.note} />
      <Row label="Date"      value={txn.transaction_date} last />

      <Footer />
    </Overlay>
  );
}

/* ══════════════════════════════════════════════════════════════════
   CREDIT STATEMENT
══════════════════════════════════════════════════════════════════ */
export function CreditReceipt({ credit, profile, onClose }) {
  const biz = profile.business_name || profile.owner_name || "My Business";
  const pct = Math.min(100, ((credit.amount_paid || 0) / (credit.total_amount || 1)) * 100);
  const statusColor = { paid: GRN, active: "#f59e0b", partially_paid: "#f59e0b", overdue: "#dc2626" }[credit.status] || "#f59e0b";

  return (
    <Overlay onClose={onClose} pdfName={`KudiAITrack_Credit_Statement_${credit.date_given || "today"}.pdf`}>
      <Header
        title="CREDIT STATEMENT"
        business={biz}
        email={SUPPORT_EMAIL}
        date={credit.date_given || new Date().toISOString().slice(0, 10)}
        id={credit.id}
      />

      <AmountHero
        label="Outstanding Balance"
        amount={fmt(credit.outstanding)}
        color="#d97706"
        badge={(credit.status || "active").replace("_", " ").toUpperCase()}
        badgeColor={statusColor}
      />

      <Progress pct={pct} paid={credit.amount_paid} total={credit.total_amount} />

      <SectionHead label="Debtor Information" />
      <Row label="Name"        value={credit.customer_name} bold />
      <Row label="Phone"       value={credit.phone} />
      <Row label="Address"     value={credit.address} />
      <Sep />
      <SectionHead label="Credit Details" />
      <Row label="Total Owed"  value={fmt(credit.total_amount)} />
      <Row label="Amount Paid" value={fmt(credit.amount_paid)} color={GRN} bold />
      <Row label="Outstanding" value={fmt(credit.outstanding)} color="#d97706" bold />
      <Row label="Date Given"  value={credit.date_given} />
      <Row label="Due Date"    value={credit.due_date} />
      <Row label="Notes"       value={credit.notes} last />

      <Footer />
    </Overlay>
  );
}

/* ══════════════════════════════════════════════════════════════════
   BILL PAYMENT RECEIPT
══════════════════════════════════════════════════════════════════ */
export function BillReceipt({ bill, onClose }) {
  const dateStr = bill.created_at
    ? new Date(bill.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
    : new Date().toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });

  return (
    <Overlay onClose={onClose} pdfName={`KudiAITrack_Bill_Receipt_${dateStr}.pdf`}>
      <Header
        title="BILL PAYMENT RECEIPT"
        business={bill.businessName || "My Business"}
        email={SUPPORT_EMAIL}
        date={dateStr}
        id={bill.id}
      />

      <AmountHero
        label="Amount Paid"
        amount={fmt(bill.amount)}
        color={GRN}
        badge="SUCCESSFUL"
        badgeColor={GRN}
      />

      <SectionHead label="Payment Details" />
      <Row label="Service"     value={bill.service || bill.category} bold />
      <Row label="Description" value={bill.item_name} />
      <Row label="Beneficiary" value={bill.customer_name} />
      {bill.token && <Row label="Token / Units" value={bill.token} color="#d97706" bold />}
      <Row label="Receipt No"  value={bill.receiptId || bill.id?.toString().slice(0, 8).toUpperCase()} />
      <Row label="Reference"   value={bill.apiRef} />
      {bill.staffName && <Row label="Processed by" value={bill.staffName} />}
      <Row label="Date"        value={dateStr} last />

      <Footer />
    </Overlay>
  );
}

/* ══════════════════════════════════════════════════════════════════
   ASO SAVINGS STATEMENT
══════════════════════════════════════════════════════════════════ */
export function AsoReceipt({ client, profile, onClose }) {
  const biz = profile.business_name || profile.owner_name || "My Business";

  return (
    <Overlay onClose={onClose} pdfName={`KudiAITrack_Ajo_Statement_${client.full_name || "client"}.pdf`}>
      <Header
        title="AJO SAVINGS STATEMENT"
        business={biz}
        email={SUPPORT_EMAIL}
        date={new Date().toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
        id={client.id}
      />

      <AmountHero
        label="Current Balance"
        amount={fmt(client.current_balance)}
        color={NAVY}
        badge={(client.status || "ACTIVE").toUpperCase()}
        badgeColor={NAVY}
      />

      <SectionHead label="Client Information" />
      <Row label="Name"         value={client.full_name} bold />
      <Row label="Phone"        value={client.phone} />
      <Sep />
      <SectionHead label="Savings Summary" />
      <Row label="Total Saved"  value={fmt(client.total_saved)}    color={GRN}   bold />
      <Row label="Withdrawn"    value={fmt(client.total_withdrawn)} color="#dc2626" />
      <Row label="Balance"      value={fmt(client.current_balance)} color={NAVY}   bold />
      <Sep />
      <SectionHead label="Plan Details" />
      <Row label="Frequency"    value={client.contribution_frequency} />
      <Row label="Contribution" value={fmt(client.contribution_amount)} />
      <Row label="Next Due"     value={client.next_contribution_date} />
      <Row label="Registered"   value={client.registration_date} />
      <Row label="Notes"        value={client.notes} last />

      <Footer />
    </Overlay>
  );
}
