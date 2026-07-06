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
