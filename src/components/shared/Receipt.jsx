/**
 * Professional banking-style receipts.
 * Logo left · Transaction title + date right · Navy + green palette.
 * Captured via html2canvas → PDF download or shared as PNG via Web Share API.
 */
import { useRef, useState, useEffect } from "react";
import html2canvas from "html2canvas";
import { jsPDF }   from "jspdf";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { savePdf }        from "../../utils/pdfSave";
import { createReportPdf } from "../../utils/generateReportPdf";

const fmt  = (n) => `₦${Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
const NAVY = "#1B2A5E";
const NAV2 = "#0F1D42";
const GRN  = "#16a34a";
const GRN2 = "#22c55e";
const YEAR = new Date().getFullYear();
const SUPPORT_EMAIL = "support@kudiai.app";

const refNo = (id) =>
  id ? `KT-${id.toString().replace(/-/g, "").slice(0, 8).toUpperCase()}`
     : `KT-${Date.now().toString(36).toUpperCase().slice(-8)}`;

/* ── Canvas capture helper ───────────────────────────────────────── */
async function captureCanvas(el) {
  // Clone off-screen so viewport clipping never truncates tall receipts
  const clone = el.cloneNode(true);
  const wrap  = document.createElement("div");
  Object.assign(wrap.style, {
    position: "absolute", top: "0", left: "-9999px",
    width: `${el.offsetWidth}px`, background: "#ffffff",
  });
  wrap.appendChild(clone);
  document.body.appendChild(wrap);
  await new Promise((r) => setTimeout(r, 150));

  try {
    return await html2canvas(clone, {
      scale: 2.5, useCORS: true, allowTaint: false,
      backgroundColor: "#ffffff", logging: false, imageTimeout: 10000,
      width:        clone.scrollWidth,
      height:       clone.scrollHeight,
      windowWidth:  clone.scrollWidth,
      windowHeight: clone.scrollHeight,
      scrollX: 0, scrollY: 0,
    });
  } finally {
    document.body.removeChild(wrap);
  }
}

async function captureFile(ref) {
  const canvas = await captureCanvas(ref.current);
  return new Promise((res) =>
    canvas.toBlob(
      (blob) => res(new File([blob], "kuditrack-receipt.png", { type: "image/png" })),
      "image/png"
    )
  );
}

async function downloadPDF(ref, filename) {
  const canvas  = await captureCanvas(ref.current);
  const imgData = canvas.toDataURL("image/png");
  const mmW = (canvas.width  / 2.5) * (25.4 / 96);
  const mmH = (canvas.height / 2.5) * (25.4 / 96);
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: [mmW, mmH] });
  pdf.addImage(imgData, "PNG", 0, 0, mmW, mmH);
  await savePdf(pdf, filename || "KudiAITrack_Receipt.pdf");
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror   = reject;
    reader.readAsDataURL(file);
  });
}

async function nativeShare(file) {
  if (Capacitor.isNativePlatform()) {
    try {
      const base64 = await fileToBase64(file);
      const saved  = await Filesystem.writeFile({
        path:      file.name,
        data:      base64,
        directory: Directory.Cache,
        recursive: true,
      });
      await Share.share({
        title: "KudiAI Track Receipt",
        url:   saved.uri,
        dialogTitle: "Share Receipt",
      });
    } catch (e) {
      if (e?.message?.includes("cancel") || e?.errorMessage?.includes("cancel")) return;
    }
    return;
  }
  // Web fallback: download the PNG
  const url = URL.createObjectURL(file);
  const a   = document.createElement("a");
  a.href = url; a.download = file.name; a.click();
  URL.revokeObjectURL(url);
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
function ShareButtons({ cardRef, pdfName, cachedPng }) {
  const [busy,    setBusy]    = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  // Use pre-captured PNG when available so navigator.share is called
  // immediately within the user gesture (no async gap → share sheet opens reliably)
  const getFile = () => cachedPng ? Promise.resolve(cachedPng) : captureFile(cardRef);

  const onShare = async () => {
    setBusy(true);
    try   { const f = await getFile(); await nativeShare(f); }
    catch { /* ignore */ }
    finally { setBusy(false); }
  };

  const onSavePDF = async () => {
    setPdfBusy(true);
    try   { await downloadPDF(cardRef, pdfName); }
    catch { /* ignore */ }
    finally { setPdfBusy(false); }
  };

  const Btn = ({ onClick, busy: isBusy, bg, children, title }) => (
    <button onClick={onClick} disabled={busy || pdfBusy} title={title}
      className="flex-1 py-4 rounded-2xl flex items-center justify-center active:scale-95 transition-transform disabled:opacity-60 shadow-lg"
      style={{ background: bg }}>
      {isBusy
        ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        : children
      }
    </button>
  );

  return (
    <div className="flex gap-3 mt-6 w-full max-w-[340px] mx-auto">
      {/* WhatsApp — opens native share sheet (pick WhatsApp from list) */}
      <Btn onClick={onShare} busy={busy} bg="#25D366" title="Share via WhatsApp">
        <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      </Btn>

      {/* Native share sheet */}
      <Btn onClick={onShare} busy={busy} bg={NAVY} title="Share">
        <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
        </svg>
      </Btn>

      {/* Save PDF */}
      <Btn onClick={onSavePDF} busy={pdfBusy} bg={GRN} title="Save as PDF">
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
  const cardRef   = useRef(null);
  const [cachedPng, setCachedPng] = useState(null);

  // Pre-capture PNG in the background when overlay mounts so tapping
  // WhatsApp/Share calls navigator.share immediately (no async gap = gesture preserved)
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!cardRef.current || cancelled) return;
      try {
        const f = await captureFile(cardRef);
        if (!cancelled) setCachedPng(f);
      } catch { /* ignore */ }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-start overflow-y-auto py-6 px-4"
      style={{ background: "rgba(8,12,30,0.94)", backdropFilter: "blur(12px)", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}>

      {/* Top bar */}
      <div className="flex items-center justify-between w-full max-w-[340px] mb-5">
        <span className="text-white/40 text-[10px] font-bold tracking-[3px] uppercase">Receipt Preview</span>
        <button onClick={onClose}
          className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 flex items-center justify-center transition active:scale-90 border border-white/25">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
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

      <ShareButtons cardRef={cardRef} pdfName={pdfName} cachedPng={cachedPng} />

      {/* Ready indicator */}
      <p className="text-white/20 text-xs mt-4 pb-2 flex items-center gap-1.5">
        {cachedPng
          ? <><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block"/>Ready to share</>
          : <><span className="w-1.5 h-1.5 rounded-full bg-white/30 inline-block animate-pulse"/>Preparing…</>
        }
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   TRANSACTION RECEIPT
══════════════════════════════════════════════════════════════════ */
export function TransactionReceipt({ txn, profile, onClose }) {
  const isIn   = txn.type === "in";
  const failed = txn.bill_status === "failed";
  const biz    = profile.business_name || profile.owner_name || "My Business";
  const amtColor   = failed ? "#dc2626" : isIn ? GRN : "#dc2626";
  const badgeColor = amtColor;

  return (
    <Overlay onClose={onClose} pdfName={`KudiAITrack_${isIn ? "CashIn" : "CashOut"}_Receipt_${txn.transaction_date || "today"}.pdf`}>
      <Header
        title={failed ? "FAILED BILL PAYMENT" : isIn ? "CASH IN RECEIPT" : "CASH OUT RECEIPT"}
        business={biz}
        email={SUPPORT_EMAIL}
        date={txn.transaction_date}
        id={txn.id}
      />

      <AmountHero
        label={failed ? "Amount (Not Collected)" : "Transaction Amount"}
        amount={fmt(txn.amount)}
        color={amtColor}
        badge={failed ? "FAILED" : isIn ? "CREDIT" : "DEBIT"}
        badgeColor={badgeColor}
      />

      {failed && (
        <div style={{ margin: "0 16px 12px", padding: "12px 14px", background: "#fef2f2", borderRadius: 12, border: "1px solid #fecaca" }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#b91c1c", margin: 0 }}>
            This bill payment failed. Your admin team has been alerted and will resolve it shortly.
          </p>
        </div>
      )}

      <SectionHead label="Transaction Details" />
      <Row label="Item"      value={txn.item_name}     bold />
      <Row label="Category"  value={txn.category} />
      {txn.quantity > 1 && <Row label="Quantity" value={txn.quantity} />}
      <Row label="Payment"   value={txn.payment_type} />
      {/* For bill payments: parse note into structured rows */}
      {txn.payment_type === "bill_payment" && txn.note
        ? txn.note.split(" | ").filter(s => s.includes(": ") && !/^Ref:/i.test(s.trim())).map((seg, i) => {
            const idx = seg.indexOf(": ");
            return <Row key={i} label={seg.slice(0, idx)} value={seg.slice(idx + 2)} />;
          })
        : <Row label="Customer" value={txn.customer_name} />
      }
      {txn.payment_type !== "bill_payment" && <Row label="Note" value={txn.note} />}
      {txn.payment_type === "bill_payment" && (() => { const m = (txn.note||"").match(/Ref:\s*([^\s|]+)/i); return m ? <Row label="Ref No." value={m[1]} /> : null; })()}
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
export function BillReceipt({ bill, onClose, onRetrieveToken }) {
  const [retrieving,     setRetrieving]     = useState(false);
  const [retrievedToken, setRetrievedToken] = useState(null);
  const [retrieveError,  setRetrieveError]  = useState("");

  const effectiveToken = retrievedToken || bill.token || bill.elecToken;

  const handleRetrieve = async () => {
    if (!onRetrieveToken || retrieving) return;
    setRetrieving(true); setRetrieveError("");
    try {
      const tok = await onRetrieveToken(bill.apiRef);
      setRetrievedToken(tok);
    } catch (e) {
      setRetrieveError(e.message || "Token not found. Try again later.");
    } finally {
      setRetrieving(false);
    }
  };

  const dateStr = bill.created_at
    ? new Date(bill.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
    : new Date().toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });

  const showRetrieveBtn = !!onRetrieveToken && !effectiveToken && !retrieving;
  const cat = bill.category;

  /* ── Category-specific detail rows ── */
  const DetailRows = () => {
    switch (cat) {
      case "airtime":
        return <>
          <Row label="Network"    value={bill.network} bold />
          <Row label="Phone No."  value={bill.phone || bill.customer_name} />
        </>;
      case "data":
        return <>
          <Row label="Network"    value={bill.network} bold />
          <Row label="Phone No."  value={bill.phone || bill.customer_name} />
          <Row label="Plan"       value={bill.planName || bill.item_name} />
        </>;
      case "print-airtime":
        return <>
          <Row label="Network"    value={bill.network} bold />
          <Row label="Face Value" value={bill.value ? `₦${bill.value} per card` : bill.item_name} />
          <Row label="Quantity"   value={bill.quantity ? `${bill.quantity} PIN(s)` : bill.customer_name} />
        </>;
      case "print-data":
        return <>
          <Row label="Network"    value={bill.network} bold />
          <Row label="Plan"       value={bill.planName || bill.item_name} />
          <Row label="Quantity"   value={bill.quantity ? `${bill.quantity} PIN(s)` : bill.customer_name} />
        </>;
      case "airtime-bundle":
        return <>
          <Row label="Sets"       value={bill.sets ? `${bill.sets} set(s)` : bill.item_name} bold />
          <Row label="Networks"   value="MTN, Airtel, 9mobile, Glo" />
        </>;
      case "cable":
        return <>
          <Row label="Provider"   value={bill.providerName || bill.service} bold />
          <Row label="Package"    value={bill.packageName || bill.item_name} />
          <Row label="Smartcard"  value={bill.smartcard || bill.customer_name} />
        </>;
      case "electricity":
        return <>
          <Row label="Provider"        value={bill.providerName || bill.service} bold />
          <Row label="Meter No."       value={bill.meterNo || bill.customer_name} />
          <Row label="Meter Type"      value={bill.meterTypeName || (bill.meterType === "01" ? "Prepaid" : bill.meterType === "02" ? "Postpaid" : (bill.meterType || ""))} />
          {bill.phone && <Row label="Phone"           value={bill.phone} />}
          {bill.meterAddress  && <Row label="Meter Address"   value={bill.meterAddress} />}
          {bill.stationAddress && <Row label="Station Address" value={bill.stationAddress} />}
        </>;
      case "betting":
        return <>
          <Row label="Platform"   value={bill.platformName || bill.service} bold />
          <Row label="Account ID" value={bill.customerId || bill.customer_name} />
        </>;
      case "waec":
      case "jamb":
        return <>
          <Row label="Phone No."  value={bill.phone || bill.customer_name} />
          <Row label="Exam"       value={bill.item_name} />
        </>;
      case "spectranet":
      case "smile":
        return <>
          <Row label="Account No." value={bill.accountNo || bill.customer_name} />
          <Row label="Plan"        value={bill.planName || bill.item_name} />
        </>;
      default:
        return <>
          <Row label="Description" value={bill.item_name} />
          <Row label="Beneficiary" value={bill.customer_name} />
        </>;
    }
  };

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
      <Row label="Service"  value={bill.service || bill.category} bold />
      <DetailRows />
      {bill.cardDetails && <Row label="Card Details" value={bill.cardDetails} color="#1d4ed8" bold />}
      {bill.apiRef && <Row label="Ref No." value={bill.apiRef} />}
      {bill.psRef  && <Row label="Payment Ref" value={bill.psRef} />}
      {bill.staffName && <Row label="Processed by" value={bill.staffName} />}
      <Row label="Date" value={dateStr} last />

      {/* ── Electricity Token — prominent card ── */}
      {effectiveToken && (
        <div style={{ margin: "10px 16px 4px", background: "linear-gradient(135deg,#fef9c3,#fef3c7)", borderRadius: 12, border: "2px solid #fbbf24", padding: "14px 16px" }}>
          <p style={{ fontSize: 9, fontWeight: 800, color: "#92400e", textTransform: "uppercase", letterSpacing: 1.5, margin: "0 0 6px" }}>
            Electricity Token
          </p>
          <p style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 900, color: "#1e293b", margin: 0, letterSpacing: 3, wordBreak: "break-all", textAlign: "center" }}>
            {effectiveToken}
          </p>
          <p style={{ fontSize: 9, color: "#92400e", margin: "6px 0 0", textAlign: "center" }}>
            Enter this code on your prepaid meter to load units
          </p>
        </div>
      )}

      {/* ── PINs / Vouchers ── */}
      {bill.pinsArr?.length > 0 && (
        <>
          <SectionHead label={`Voucher PIN(s) — ${bill.pinsArr.length} total`} />
          {bill.pinsArr.map((pin, i) => {
            const serial = pin.EPIN_SERIAL ?? pin.sno ?? pin.serial ?? "";
            const code   = pin.EPIN ?? pin.pin ?? pin.code ?? JSON.stringify(pin);
            return (
              <div key={i} style={{ margin: "4px 16px", padding: "10px 14px", background: "#f0fdf4", borderRadius: 10, border: "1px solid #bbf7d0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 9, color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    PIN {i + 1}{pin.network ? ` · ${pin.network}` : ""}
                  </span>
                  {serial ? <span style={{ fontSize: 9, color: "#9ca3af", fontFamily: "monospace" }}>S/N: {serial}</span> : null}
                </div>
                <p style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 900, color: "#15803d", margin: 0, wordBreak: "break-all", letterSpacing: 1.5 }}>{code}</p>
              </div>
            );
          })}
          <div style={{ height: 8 }} />
        </>
      )}

      {/* ── Electricity token retrieval (only when token not yet known) ── */}
      {(showRetrieveBtn || retrieving || retrieveError) && (
        <div style={{ margin: "12px 16px 4px", borderRadius: 12, overflow: "hidden", border: "2px solid #fbbf24" }}>
          <div style={{ background: "linear-gradient(135deg,#fef3c7,#fde68a)", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth={2.5} strokeLinecap="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            <span style={{ fontSize: 10, fontWeight: 800, color: "#92400e", letterSpacing: 1, textTransform: "uppercase" }}>
              Retrieve Token
            </span>
          </div>
          <div style={{ background: "white", padding: "14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            {retrieving ? (
              <>
                <div style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid #fef3c7", borderTopColor: "#f59e0b", animation: "spin 0.8s linear infinite" }} />
                <p style={{ fontSize: 11, color: "#64748b", textAlign: "center", margin: 0 }}>Querying provider for token...</p>
              </>
            ) : (
              <>
                {retrieveError && (
                  <p style={{ fontSize: 11, color: "#b91c1c", textAlign: "center", margin: "0 0 6px", fontWeight: 600 }}>{retrieveError}</p>
                )}
                <button
                  onClick={handleRetrieve}
                  style={{ background: "#fef3c7", color: "#92400e", border: "1.5px solid #fde68a", borderRadius: 10, padding: "8px 20px", fontSize: 12, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                  {retrieveError ? "Try Again" : "Retrieve Electricity Token"}
                </button>
                <p style={{ fontSize: 10, color: "#94a3b8", textAlign: "center", margin: 0 }}>
                  Token may still be available from the provider
                </p>
              </>
            )}
          </div>
        </div>
      )}

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

/* ══════════════════════════════════════════════════════════════════
   STAFF ACTIVITY STATEMENT  —  Reports.jsx modality
   Full-screen selector → 794 px preview → multi-page PDF export.
   Letterhead, stat grids, tables, and export identical to Reports.jsx.
══════════════════════════════════════════════════════════════════ */

/* ── date helpers ── */
function stmtAddDays(d, n) {
  const dt = new Date(d); dt.setDate(dt.getDate() + n);
  return dt.toISOString().split("T")[0];
}
function stmtMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
}
function stmtTodayStr() { return new Date().toISOString().split("T")[0]; }
function stmtRange(period, cFrom, cTo) {
  const t = stmtTodayStr();
  if (period === "today")  return { from: t, to: t };
  if (period === "week")   return { from: stmtAddDays(t,-6), to: t };
  if (period === "month")  return { from: stmtMonthStart(), to: t };
  if (period === "year")   return { from: `${new Date().getFullYear()}-01-01`, to: t };
  return { from: cFrom || t, to: cTo || t };
}
function stmtFmtD(s) {
  if (!s) return "—";
  return new Date(s+"T00:00:00").toLocaleDateString("en-NG",{day:"numeric",month:"short",year:"numeric"});
}

const STMT_PERIODS = [
  {id:"today", label:"Today"},
  {id:"week",  label:"This Week"},
  {id:"month", label:"This Month"},
  {id:"year",  label:"This Year"},
  {id:"custom",label:"Custom"},
];

/* ══════════════════════════════════════════════════════════════════
   AJO CONTRIBUTION / WITHDRAWAL RECEIPT
══════════════════════════════════════════════════════════════════ */
export function AjoTxReceipt({ txn, clientName, businessName, onClose }) {
  const isWithdraw = txn.type === "withdrawal" || txn.transaction_type === "withdrawal";
  const dateStr = txn.created_at
    ? new Date(txn.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
    : txn.date || new Date().toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
  const amtColor = isWithdraw ? "#dc2626" : GRN;

  return (
    <Overlay onClose={onClose} pdfName={`KudiAITrack_Ajo_${isWithdraw ? "Withdrawal" : "Contribution"}_${dateStr}.pdf`}>
      <Header
        title={isWithdraw ? "AJO WITHDRAWAL RECEIPT" : "AJO CONTRIBUTION RECEIPT"}
        business={businessName || "My Business"}
        email={SUPPORT_EMAIL}
        date={dateStr}
        id={txn.id}
      />

      <AmountHero
        label={isWithdraw ? "Amount Withdrawn" : "Amount Contributed"}
        amount={fmt(txn.amount)}
        color={amtColor}
        badge={isWithdraw ? "DEBIT" : "CREDIT"}
        badgeColor={amtColor}
      />

      <SectionHead label="Transaction Details" />
      <Row label="Member"         value={clientName}                        bold />
      <Row label="Type"           value={isWithdraw ? "Withdrawal" : "Contribution"} />
      <Row label="Payment Method" value={txn.payment_method || txn.payment_type || "Cash"} />
      <Row label="Date"           value={dateStr} />
      <Row label="Notes"          value={txn.notes || txn.note}             last />

      <Footer />
    </Overlay>
  );
}

/* ══════════════════════════════════════════════════════════════════
   COOP SAVINGS / CONTRIBUTION RECEIPT
══════════════════════════════════════════════════════════════════ */
export function CoopSavingReceipt({ saving, orgName, onClose }) {
  const isWd    = saving.type === "withdrawal";
  const dateStr = saving.created_at
    ? new Date(saving.created_at).toLocaleString("en-NG", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" })
    : "—";
  const color = isWd ? "#dc2626" : GRN;
  return (
    <Overlay onClose={onClose} pdfName={`KudiAITrack_${isWd ? "Withdrawal" : "Contribution"}_${(saving.id||"").slice(0,8)}.pdf`}>
      <Header
        title={isWd ? "WITHDRAWAL RECEIPT" : "CONTRIBUTION RECEIPT"}
        business={orgName || "Organisation"} email={SUPPORT_EMAIL} date={dateStr} id={saving.id}
      />
      <AmountHero label={isWd ? "Amount Withdrawn" : "Amount Contributed"} amount={fmt(saving.amount)}
        color={color} badge={isWd ? "DEBIT" : "CREDIT"} badgeColor={color} />
      <SectionHead label="Transaction Details" />
      <Row label="Member"         value={saving.org_members?.full_name}          bold />
      <Row label="Membership ID"  value={saving.org_members?.membership_id} />
      <Row label="Type"           value={isWd ? "Withdrawal" : "Contribution"} />
      <Row label="Program"        value={saving.org_contribution_programs?.name} />
      <Row label="Payment Method" value={saving.payment_method} />
      <Row label="Balance After"  value={saving.balance_after != null ? fmt(saving.balance_after) : undefined} />
      <Row label="Notes"          value={saving.notes} />
      <Row label="Date & Time"    value={dateStr} last />
      <Footer />
    </Overlay>
  );
}

/* ══════════════════════════════════════════════════════════════════
   COOP BULK WITHDRAWAL RECEIPT
══════════════════════════════════════════════════════════════════ */
export function CoopBulkWithdrawalReceipt({ withdrawal, orgName, onClose }) {
  const dateStr = withdrawal.created_at
    ? new Date(withdrawal.created_at).toLocaleString("en-NG", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" })
    : "—";
  return (
    <Overlay onClose={onClose} pdfName={`KudiAITrack_BulkWithdrawal_${(withdrawal.id||"").slice(0,8)}.pdf`}>
      <Header title="BULK WITHDRAWAL RECEIPT" business={orgName || "Organisation"}
        email={SUPPORT_EMAIL} date={dateStr} id={withdrawal.id} />
      <AmountHero label="Total Amount Withdrawn" amount={fmt(withdrawal.total_amount)}
        color="#dc2626" badge="DEBIT" badgeColor="#dc2626" />
      <SectionHead label="Withdrawal Details" />
      <Row label="Purpose"          value={withdrawal.purpose}                                                        bold />
      <Row label="Method"           value={withdrawal.method === "equal" ? "Equal deduction" : "Custom amounts"} />
      <Row label="Members Affected" value={withdrawal.member_count} />
      {withdrawal.per_member_amount > 0 && <Row label="Per Member" value={fmt(withdrawal.per_member_amount)} />}
      <Row label="Authorized By"    value={withdrawal.authorized_by} />
      <Row label="Notes"            value={withdrawal.notes} />
      <Row label="Date"             value={dateStr} last />
      <Footer />
    </Overlay>
  );
}

/* ══════════════════════════════════════════════════════════════════
   COOP WITHDRAWAL REQUEST RECEIPT
══════════════════════════════════════════════════════════════════ */
export function CoopWithdrawalRequestReceipt({ request, orgName, memberName, onClose }) {
  const dateStr = request.created_at
    ? new Date(request.created_at).toLocaleString("en-NG", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" })
    : "—";
  const statusColor = request.status === "approved" ? GRN : request.status === "rejected" ? "#dc2626" : "#f59e0b";
  return (
    <Overlay onClose={onClose} pdfName={`KudiAITrack_WithdrawalRequest_${(request.id||"").slice(0,8)}.pdf`}>
      <Header title="WITHDRAWAL REQUEST" business={orgName || "Organisation"}
        email={SUPPORT_EMAIL} date={dateStr} id={request.id} />
      <AmountHero label="Amount Requested" amount={fmt(request.amount)}
        color={statusColor} badge={(request.status || "pending").toUpperCase()} badgeColor={statusColor} />
      <SectionHead label="Request Details" />
      <Row label="Member"      value={memberName || request.org_members?.full_name} bold />
      <Row label="Membership"  value={request.org_members?.membership_id} />
      <Row label="Reason"      value={request.reason} />
      <Row label="Status"      value={request.status}  color={statusColor} bold />
      <Row label="Admin Notes" value={request.admin_notes} />
      <Row label="Requested"   value={dateStr} last />
      <Footer />
    </Overlay>
  );
}

/* ══════════════════════════════════════════════════════════════════
   CREDIT DEBT-PAYMENT RECEIPT
══════════════════════════════════════════════════════════════════ */
export function CreditPaymentReceipt({ payment, credit, businessName, onClose }) {
  const dateStr = payment.created_at
    ? new Date(payment.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
    : payment.payment_date || new Date().toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
  return (
    <Overlay onClose={onClose} pdfName={`KudiAITrack_CreditPayment_${dateStr}.pdf`}>
      <Header
        title="CREDIT PAYMENT RECEIPT"
        business={businessName || "My Business"}
        email={SUPPORT_EMAIL}
        date={dateStr}
        id={payment.id}
      />

      <AmountHero
        label="Payment Amount"
        amount={fmt(payment.amount)}
        color={GRN}
        badge="PAYMENT RECEIVED"
        badgeColor={GRN}
      />

      <SectionHead label="Payment Details" />
      <Row label="Debtor"         value={credit?.customer_name}             bold />
      <Row label="Payment Method" value={(payment.payment_method || "Cash").replace(/_/g, " ")} />
      <Row label="Date Paid"      value={dateStr} />
      <Row label="Notes"          value={payment.notes}                     last />
      <Sep />
      <SectionHead label="Credit Summary" />
      <Row label="Total Owed"     value={fmt(credit?.total_amount)} />
      <Row label="Total Paid"     value={fmt(credit?.amount_paid)} color={GRN} bold />
      <Row label="Outstanding"    value={fmt(credit?.outstanding)} color="#d97706" bold />
      <Row label="Status"         value={(credit?.status || "active").replace(/_/g, " ").toUpperCase()} last />

      <Footer />
    </Overlay>
  );
}

async function buildNativeActivityStatementPDF(staffName, businessName, from, to, txns, cashIn, cashOut, profit, credits, asoClients) {
  const prd  = from === to ? stmtFmtD(from) : `${stmtFmtD(from)} – ${stmtFmtD(to)}`;
  const sname = staffName || "Staff";

  const pdf = await createReportPdf({
    title: "Staff Activity Statement",
    businessName: businessName || "My Business",
    period: prd,
    subtitle: sname,
  });
  const { addStats, addSectionTitle, addTable, fmtN } = pdf;

  addStats([
    { label:"Cash In",      value:fmtN(cashIn),  color:"#16a34a", bg:"#f0fdf4" },
    { label:"Cash Out",     value:fmtN(cashOut), color:"#ef4444", bg:"#fef2f2" },
    { label:"Net Profit",   value:fmtN(profit),  color:profit>=0?"#16a34a":"#ef4444", bg:"#f8fafc" },
    { label:"Transactions", value:txns.length,   color:"#0284c7", bg:"#eff6ff" },
  ]);
  addSectionTitle("Transaction Log");
  addTable(
    [{ key:"date",   label:"Date",     w:0.13 },
     { key:"item",   label:"Item",     bold:true, w:0.26 },
     { key:"cat",    label:"Category", w:0.16 },
     { key:"type",   label:"Type",     bold:true, color:r=>r._t==="in"?[22,163,74]:[220,38,38], w:0.11 },
     { key:"amount", label:"Amount",   right:true, bold:true, w:0.17 },
     { key:"pay",    label:"Payment",  w:0.17 }],
    txns.slice(0,80).map(t=>({
      date:stmtFmtD(t.transaction_date), item:t.item_name||"—", cat:t.category||"—",
      type:t.type==="in"?"Income":"Expense", amount:fmtN(t.amount),
      pay:t.payment_type||"—", _t:t.type
    }))
  );

  const crAmt   = credits.reduce((s,c) => s+(c.outstanding||0), 0);
  const overdue = credits.filter(c => c.status === "overdue");
  addStats([
    { label:"Outstanding Credit", value:fmtN(crAmt),     color:"#d97706", bg:"#fffbeb" },
    { label:"Credit Records",     value:credits.length,  color:"#334155", bg:"#f8fafc" },
    { label:"Overdue Accounts",   value:overdue.length,  color:"#dc2626", bg:"#fef2f2" },
    { label:"Overdue Amount",     value:fmtN(overdue.reduce((s,c)=>s+(c.outstanding||0),0)), color:"#dc2626", bg:"#fff1f2" },
  ]);
  if (credits.length > 0) {
    addSectionTitle("Credit Records");
    addTable(
      [{ key:"name",   label:"Customer", bold:true, w:0.24 },
       { key:"total",  label:"Total",    right:true, w:0.15 },
       { key:"paid",   label:"Paid",     right:true, color:()=>[22,163,74], w:0.15 },
       { key:"owed",   label:"Owed",     right:true, bold:true, color:r=>r._s==="overdue"?[220,38,38]:[220,38,38], w:0.15 },
       { key:"due",    label:"Due Date", w:0.17 },
       { key:"status", label:"Status",   bold:true, color:r=>r._s==="overdue"?[220,38,38]:r._s==="paid"?[22,163,74]:[100,116,139], w:0.14 }],
      credits.map(c=>({
        name:c.customer_name||"—", total:fmtN(c.total_amount||0), paid:fmtN(c.amount_paid||0),
        owed:fmtN(c.outstanding||0), due:stmtFmtD(c.due_date),
        status:(c.status||"active").replace(/_/g," ").toUpperCase(), _s:c.status
      }))
    );
  }

  const ajoBal = asoClients.reduce((s,c) => s+(c.current_balance||0), 0);
  addStats([
    { label:"Ajo Balance",  value:fmtN(ajoBal),                                                color:"#7c3aed", bg:"#faf5ff" },
    { label:"Ajo Clients",  value:asoClients.length,                                           color:"#0284c7", bg:"#eff6ff" },
    { label:"Total Saved",  value:fmtN(asoClients.reduce((s,c)=>s+(c.total_saved||0),0)),     color:"#16a34a", bg:"#f0fdf4" },
    { label:"Withdrawn",    value:fmtN(asoClients.reduce((s,c)=>s+(c.total_withdrawn||0),0)), color:"#ef4444", bg:"#fef2f2" },
  ]);
  if (asoClients.length > 0) {
    addSectionTitle("Ajo / Savings Clients");
    addTable(
      [{ key:"name",    label:"Client",       bold:true, w:0.26 },
       { key:"freq",    label:"Frequency",    w:0.16 },
       { key:"contrib", label:"Contribution", right:true, w:0.18 },
       { key:"saved",   label:"Total Saved",  right:true, color:()=>[22,163,74], w:0.18 },
       { key:"balance", label:"Balance",      right:true, bold:true, color:()=>[124,58,237], w:0.22 }],
      asoClients.map(c=>({
        name:c.full_name||"—", freq:c.contribution_frequency||"—",
        contrib:fmtN(c.contribution_amount||0), saved:fmtN(c.total_saved||0),
        balance:fmtN(c.current_balance||0)
      }))
    );
  }

  const name = sname.replace(/\s+/g, "_");
  await pdf.save(`KudiAITrack_Staff_Statement_${name}_${from}_${to}.pdf`);
}

export function StaffActivityStatement({ store, staffName, businessName, onClose }) {
  const [period,    setPeriod]    = useState("month");
  const [customFrom,setCustomFrom]= useState(stmtTodayStr());
  const [customTo,  setCustomTo]  = useState(stmtTodayStr());
  const [exporting, setExporting] = useState(false);

  const transactions = store?.transactions || [];
  const credits      = store?.credits      || [];
  const asoClients   = store?.asoClients   || [];

  const { from, to } = stmtRange(period, customFrom, customTo);
  const txns    = transactions.filter(t => t.transaction_date >= from && t.transaction_date <= to);
  const cashIn  = txns.filter(t => t.type==="in" ).reduce((s,t) => s+t.amount, 0);
  const cashOut = txns.filter(t => t.type==="out").reduce((s,t) => s+t.amount, 0);
  const profit  = cashIn - cashOut;

  const exportPDF = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await buildNativeActivityStatementPDF(staffName, businessName, from, to, txns, cashIn, cashOut, profit, credits, asoClients);
    } catch(e) { console.error("PDF export:", e); }
    setExporting(false);
  };

  return (
    <>

      {/* Selector screen */}
      <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-900 flex flex-col">
        <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <button onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center active:scale-95 transition">
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
          </button>
          <div>
            <p className="text-base font-black text-slate-800 dark:text-white">Activity Statement</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">{staffName} · PDF saved to device</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5">

          <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">Select Period</p>
          <div className="flex gap-1.5 flex-wrap mb-3">
            {STMT_PERIODS.map(p => (
              <button key={p.id} onClick={() => setPeriod(p.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 ${
                  period===p.id
                    ? "bg-slate-800 dark:bg-white text-white dark:text-slate-900 shadow-sm"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                }`}>
                {p.label}
              </button>
            ))}
          </div>

          {period==="custom" && (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 mb-5 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">From</p>
                <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}
                  className="w-full text-sm text-slate-800 dark:text-slate-100 bg-transparent focus:outline-none"/>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">To</p>
                <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)}
                  className="w-full text-sm text-slate-800 dark:text-slate-100 bg-transparent focus:outline-none"/>
              </div>
            </div>
          )}

          {period!=="custom" && (
            <div className="bg-slate-100 dark:bg-slate-800 rounded-xl px-4 py-2.5 mb-5 flex items-center gap-2">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="text-slate-400 flex-shrink-0">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <span className="font-bold text-slate-700 dark:text-slate-200">{stmtFmtD(from)}</span>
                {from!==to && <> → <span className="font-bold text-slate-700 dark:text-slate-200">{stmtFmtD(to)}</span></>}
              </p>
            </div>
          )}

          {/* Quick stats preview */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 mb-5 grid grid-cols-3 gap-3">
            {[["Cash In",fmt(cashIn),"text-green-600"],["Cash Out",fmt(cashOut),"text-red-500"],["Profit",fmt(profit),profit>=0?"text-green-600":"text-red-500"],["Txns",txns.length,"text-blue-600"],["Credits",credits.length,"text-amber-600"],["Ajo",asoClients.length,"text-violet-600"]].map(([l,v,c]) => (
              <div key={l} className="text-center">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-1">{l}</p>
                <p className={`text-sm font-extrabold tabular ${c}`}>{v}</p>
              </div>
            ))}
          </div>

          <button onClick={exportPDF} disabled={exporting}
            className="w-full py-4 bg-green-600 disabled:opacity-60 text-white rounded-2xl font-extrabold text-sm active:scale-[0.98] shadow-lg flex items-center justify-center gap-2 transition-all">
            {exporting
              ? <><div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin"/>Generating PDF…</>
              : <><svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>Save PDF to Device</>
            }
          </button>
          <div className="h-8"/>
        </div>
      </div>
    </>
  );
}
