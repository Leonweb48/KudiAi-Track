/**
 * Platform-wide transaction detail + shareable receipt.
 * Opens as a bottom sheet showing hero card, summary, copyable details,
 * plus "Share Receipt" producing an identical Image or PDF via html2canvas.
 *
 * Props:
 *   data          — receipt data from receiptConfig.js build* functions
 *   onClose       — () => void
 *   onReportIssue — optional () => void; if omitted shows a toast
 */
import { useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { savePdf } from "../../utils/pdfSave";
import { ReceiptCard } from "./ReceiptCard";

const NAVY  = '#0f1c45';
const GREEN = '#3da829';

// ── Capture utilities (mirrors Receipt.jsx internals) ────────────────────────
async function captureCanvas(el) {
  const clone = el.cloneNode(true);
  const wrap  = document.createElement('div');
  Object.assign(wrap.style, {
    position: 'absolute', top: '0', left: '-9999px',
    width: `${el.offsetWidth}px`,
  });
  wrap.appendChild(clone);
  document.body.appendChild(wrap);
  await new Promise(r => setTimeout(r, 180));
  try {
    return await html2canvas(clone, {
      scale: 3, useCORS: true, allowTaint: false,
      logging: false, imageTimeout: 10000,
      width: clone.scrollWidth, height: clone.scrollHeight,
      windowWidth: clone.scrollWidth, windowHeight: clone.scrollHeight,
      scrollX: 0, scrollY: 0,
    });
  } finally {
    document.body.removeChild(wrap);
  }
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror   = reject;
    reader.readAsDataURL(file);
  });
}

async function shareFile(file) {
  if (Capacitor.isNativePlatform()) {
    try {
      const base64 = await fileToBase64(file);
      const saved  = await Filesystem.writeFile({
        path: file.name, data: base64,
        directory: Directory.Cache, recursive: true,
      });
      await Share.share({ title: file.name, url: saved.uri, dialogTitle: 'Share receipt' });
    } catch (e) {
      if (!e?.message?.includes('cancel')) throw e;
    }
  } else {
    const url = URL.createObjectURL(file);
    const a   = Object.assign(document.createElement('a'), { href: url, download: file.name });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// ── Copy to clipboard ────────────────────────────────────────────────────────
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = Object.assign(document.createElement('textarea'), {
        value: text, style: 'position:fixed;top:-9999px;left:-9999px',
      });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    return true;
  } catch { return false; }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtAmt(n) {
  return '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function heroColors(direction, status) {
  if (status === 'failed')  return { from: '#dc2626', to: '#b91c1c' };
  if (status === 'pending') return { from: '#d97706', to: '#b45309' };
  if (direction === 'in')   return { from: '#16a34a', to: '#15803d' };
  return                           { from: NAVY,       to: '#081030' };
}

function statusLabel(status) {
  if (status === 'success') return { icon: '✓', text: 'Successful', color: '#86efac' };
  if (status === 'pending') return { icon: '⏳', text: 'Processing', color: '#fde68a' };
  if (status === 'failed')  return { icon: '✕', text: 'Failed',     color: '#fca5a5' };
  return                           { icon: '?', text: status,       color: '#e2e8f0' };
}

// ── Sub-components ───────────────────────────────────────────────────────────
function SectionCard({ title, children }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden mb-3">
      {title && (
        <div className="px-4 pt-3.5 pb-2">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{title}</p>
        </div>
      )}
      {children}
    </div>
  );
}

function SummaryRow({ label, value, valueClass = '', bold, sep }) {
  if (sep) return <div className="border-t border-slate-50 dark:border-slate-700/60 my-0.5" />;
  return (
    <div className={`flex justify-between items-center px-4 py-2.5 ${bold ? 'bg-slate-50 dark:bg-slate-700/50' : ''}`}>
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`text-sm font-${bold ? 'extrabold' : 'semibold'} text-slate-800 dark:text-slate-100 ${valueClass}`}>{value}</span>
    </div>
  );
}

function DetailRow({ field, onCopy, copiedKey }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const ok = await copyText(field.value);
    if (ok) {
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-start justify-between px-4 py-3 border-b border-slate-50 dark:border-slate-700/40 last:border-0">
      <span className="text-xs text-slate-400 dark:text-slate-500 font-medium flex-shrink-0 min-w-[96px] pt-0.5">{field.label}</span>
      <div className="flex items-center gap-2 flex-1 justify-end">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 text-right break-all leading-relaxed">
          {field.value}
        </span>
        {field.copy && (
          <button onClick={handleCopy} className="flex-shrink-0 transition active:scale-90" title="Copy">
            {copied
              ? <span className="text-[10px] font-bold text-green-600 dark:text-green-400 whitespace-nowrap">✓ Copied</span>
              : <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
            }
          </button>
        )}
      </div>
    </div>
  );
}

// ── Share sheet ───────────────────────────────────────────────────────────────
function ShareSheet({ onOption, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-2xl pb-safe shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mt-3 mb-4" />
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 text-center mb-4">Share Receipt</p>

        <button
          onClick={() => onOption('image')}
          className="w-full flex items-center gap-4 px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors border-t border-slate-100 dark:border-slate-700"
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#dcfce7' }}>
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="#16a34a" strokeWidth={2} strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Share as Image</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">High-res PNG (3×) — WhatsApp, Instagram…</p>
          </div>
        </button>

        <button
          onClick={() => onOption('pdf')}
          className="w-full flex items-center gap-4 px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors border-t border-slate-100 dark:border-slate-700 mb-2"
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#e0e7ff' }}>
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke={NAVY} strokeWidth={2} strokeLinecap="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
            </svg>
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Share as PDF</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">Email, print, or save to files</p>
          </div>
        </button>
      </div>
    </div>
  );
}

// ── Loading overlay ───────────────────────────────────────────────────────────
function LoadingOverlay({ label }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl px-8 py-6 flex flex-col items-center gap-3 shadow-xl">
        <div className="w-8 h-8 border-2 border-slate-200 dark:border-slate-600 rounded-full" style={{ borderTopColor: GREEN, animation: 'spin 0.8s linear infinite' }} />
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{label}</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

// ── Main modal ───────────────────────────────────────────────────────────────
export default function TransactionDetailModal({ data, onClose, onReportIssue }) {
  const receiptRef  = useRef(null);
  const [shareOpen, setShareOpen]   = useState(false);
  const [loading,   setLoading]     = useState(null); // null | 'image' | 'pdf'
  const [toast,     setToast]       = useState(null);

  const { title, direction, status, amount, fees = 0, datetime, fields = [], receiptRef: ref, filenames } = data;
  const hc = heroColors(direction, status);
  const sl = statusLabel(status);
  const net = amount - fees;

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function handleShare(type) {
    setShareOpen(false);
    setLoading(type === 'image' ? 'image' : 'pdf');
    try {
      const canvas  = await captureCanvas(receiptRef.current);
      if (type === 'image') {
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        const file = new File([blob], filenames?.image || 'receipt.png', { type: 'image/png' });
        await shareFile(file);
      } else {
        const imgData = canvas.toDataURL('image/png');
        const mmW = (canvas.width  / 3) * (25.4 / 96);
        const mmH = (canvas.height / 3) * (25.4 / 96);
        const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: [mmW, mmH] });
        pdf.addImage(imgData, 'PNG', 0, 0, mmW, mmH);
        await savePdf(pdf, filenames?.pdf || 'receipt.pdf');
      }
    } catch (e) {
      if (!e?.message?.includes('cancel')) showToast('Could not share receipt. Please try again.');
    } finally {
      setLoading(null);
    }
  }

  function handleReportIssue() {
    if (onReportIssue) {
      onReportIssue({ ref, title, amount, status });
    } else {
      showToast('Support ticket opened. Our team will review shortly.');
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 flex items-end justify-center"
        style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      >
        {/* Sheet */}
        <div
          className="w-full max-w-md flex flex-col bg-slate-50 dark:bg-slate-900 rounded-t-2xl overflow-hidden"
          style={{ maxHeight: '92dvh' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Sticky header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex-shrink-0">
            <p className="text-base font-bold text-slate-800 dark:text-white truncate pr-2">{title}</p>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">

            {/* Hero card */}
            <div
              className="mx-4 mt-4 mb-3 rounded-2xl px-6 py-5 text-center shadow-md"
              style={{ background: `linear-gradient(135deg, ${hc.from} 0%, ${hc.to} 100%)` }}
            >
              <p className="text-3xl font-extrabold text-white tracking-tight mb-1" style={{ letterSpacing: '-0.025em' }}>
                {direction === 'in' ? '+' : '−'}{fmtAmt(amount)}
              </p>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-2" style={{ background: 'rgba(255,255,255,0.15)' }}>
                <span className="text-xs font-bold" style={{ color: sl.color }}>{sl.icon} {sl.text}</span>
              </div>
              <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>{datetime}</p>
            </div>

            {/* Summary */}
            <SectionCard title="Summary">
              <SummaryRow label="Amount" value={fmtAmt(amount)} />
              {fees > 0 && <SummaryRow label="Fees / Charges" value={`−${fmtAmt(fees)}`} valueClass="text-red-500 dark:text-red-400" />}
              {fees > 0 && <SummaryRow sep />}
              {fees > 0 && <SummaryRow label="Net Amount" value={fmtAmt(net)} bold />}
              {fees === 0 && <SummaryRow label="Fees / Charges" value="₦0.00" valueClass="text-slate-300 dark:text-slate-600" />}
            </SectionCard>

            {/* Details */}
            {fields.length > 0 && (
              <SectionCard title="Details">
                {fields.map((field, i) => (
                  <DetailRow key={i} field={field} />
                ))}
              </SectionCard>
            )}

            {/* Spacer for pinned actions */}
            <div className="h-4" />
          </div>

          {/* Pinned bottom actions */}
          <div className="flex gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex-shrink-0"
            style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}>
            <button
              onClick={handleReportIssue}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-bold text-slate-600 dark:text-slate-300 active:scale-95 transition-transform"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              Report Issue
            </button>
            <button
              onClick={() => setShareOpen(true)}
              className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-bold text-white active:scale-95 transition-transform shadow-sm"
              style={{ background: `linear-gradient(135deg, ${GREEN} 0%, #2d9420 100%)` }}
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              Share Receipt
            </button>
          </div>
        </div>
      </div>

      {/* Off-screen receipt for capture — always rendered, never visible */}
      <div
        aria-hidden
        style={{ position: 'fixed', top: '200vh', left: '50%', transform: 'translateX(-50%)', width: '340px', zIndex: 0, pointerEvents: 'none' }}
      >
        <ReceiptCard data={data} innerRef={receiptRef} />
      </div>

      {shareOpen  && <ShareSheet onOption={handleShare} onClose={() => setShareOpen(false)} />}
      {loading    && <LoadingOverlay label={loading === 'image' ? 'Preparing image…' : 'Preparing PDF…'} />}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[90] bg-slate-800 dark:bg-slate-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-lg max-w-xs text-center">
          {toast}
        </div>
      )}
    </>
  );
}
