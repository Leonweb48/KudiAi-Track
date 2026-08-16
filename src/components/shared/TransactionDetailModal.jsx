/**
 * Platform-wide transaction detail + shareable receipt.
 * Shows the full ReceiptCard in-modal (what you see = what you get).
 * "Share Receipt" captures it via html2canvas as Image or PDF.
 *
 * Props:
 *   data            — receipt data from receiptConfig.js build* functions
 *   onClose         — () => void
 *   onReportIssue   — optional () => void
 *   onRetrieveToken — optional async () => string; shown for electricity receipts
 */
import { useRef, useState } from "react";
import { useToast } from "../Toast";
import { jsPDF } from "jspdf";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { savePdf } from "../../utils/pdfSave";
import { captureReceiptCanvas } from "../../utils/captureReceipt";
import { ReceiptCard } from "./ReceiptCard";
import SupportTicketModal from "./SupportTicketModal";

const GREEN = '#3da829';

// captureCanvas is now captureReceiptCanvas from ../../utils/captureReceipt

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror   = reject;
    reader.readAsDataURL(file);
  });
}

// Returns 'shared', 'downloaded', or throws
async function shareFile(file) {
  if (Capacitor.isNativePlatform()) {
    try {
      const base64 = await fileToBase64(file);
      const saved  = await Filesystem.writeFile({
        path: file.name, data: base64,
        directory: Directory.Cache, recursive: true,
      });
      await Share.share({ title: file.name, url: saved.uri, dialogTitle: 'Share receipt' });
      return 'shared';
    } catch (e) {
      if (e?.message?.includes('cancel') || e?.errorMessage?.includes('cancel')) return 'shared';
      throw e;
    }
  }
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError' || e?.message?.includes('cancel')) return 'shared';
    }
  }
  const url = URL.createObjectURL(file);
  const a   = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

// ── Electricity token retrieval ───────────────────────────────────────────────
function TokenSection({ onRetrieveToken }) {
  const [state, setState] = useState({ phase: 'idle', token: null, error: null });

  async function fetch() {
    setState({ phase: 'loading', token: null, error: null });
    try {
      const token = await onRetrieveToken();
      setState({ phase: 'done', token, error: null });
    } catch (e) {
      setState({ phase: 'error', token: null, error: e.message || 'Could not retrieve token.' });
    }
  }

  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-200 dark:border-amber-700 overflow-hidden mb-3">
      <div className="px-4 pt-3 pb-2">
        <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">Electricity Token</p>
      </div>
      {state.phase === 'done' ? (
        <div className="px-4 pb-4">
          <p className="text-sm font-mono font-extrabold text-emerald-600 dark:text-emerald-400 tracking-widest break-all leading-relaxed">
            {state.token}
          </p>
        </div>
      ) : state.phase === 'error' ? (
        <div className="px-4 pb-4 space-y-2">
          <p className="text-xs text-red-500 dark:text-red-400">{state.error}</p>
          <button onClick={fetch} className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Try again</button>
        </div>
      ) : (
        <div className="px-4 pb-4">
          <button
            onClick={fetch}
            disabled={state.phase === 'loading'}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-amber-700 dark:text-amber-400 active:scale-[.98] transition disabled:opacity-60"
          >
            {state.phase === 'loading'
              ? <><span className="w-3.5 h-3.5 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin inline-block" /> Retrieving…</>
              : <>⚡ Retrieve Electricity Token</>
            }
          </button>
        </div>
      )}
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
        className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-2xl safe-bottom shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mt-3 mb-4" />
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 text-center mb-4">Share Receipt</p>

        <button
          onClick={() => onOption('image')}
          className="w-full flex items-center gap-4 px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors border-t border-slate-100 dark:border-slate-700"
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-green-100 dark:bg-green-900/20">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="#16a34a" strokeWidth={2} strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Share as Image</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">High-res PNG · WhatsApp, Instagram…</p>
          </div>
        </button>

        <button
          onClick={() => onOption('pdf')}
          className="w-full flex items-center gap-4 px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors border-t border-slate-100 dark:border-slate-700 mb-2"
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-indigo-100 dark:bg-indigo-900/20">
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="#0f1c45" strokeWidth={2} strokeLinecap="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
            </svg>
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Save as PDF</p>
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
export default function TransactionDetailModal({ data, onClose, onReportIssue, onRetrieveToken }) {
  const receiptRef = useRef(null);
  const [shareOpen,  setShareOpen]  = useState(false);
  const [loading,    setLoading]    = useState(null);
  const [ticketData, setTicketData] = useState(null);
  const toast = useToast();

  const { title, fields = [], receiptRef: ref, filenames } = data;
  const retrievableField = fields.find(f => f.retrievable);

  async function handleShare(type) {
    setShareOpen(false);
    setLoading(type);
    try {
      const canvas = await captureReceiptCanvas(receiptRef.current);
      let result;
      if (type === 'image') {
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        const file = new File([blob], filenames?.image || 'receipt.png', { type: 'image/png' });
        result = await shareFile(file);
      } else {
        const imgData = canvas.toDataURL('image/png');
        const mmW = (canvas.width  / 3) * (25.4 / 96);
        const mmH = (canvas.height / 3) * (25.4 / 96);
        const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: [mmW, mmH] });
        pdf.addImage(imgData, 'PNG', 0, 0, mmW, mmH);
        await savePdf(pdf, filenames?.pdf || 'receipt.pdf');
        result = Capacitor.isNativePlatform() ? 'shared' : 'downloaded';
      }
      if (result === 'downloaded') toast({ title: 'Receipt saved to your downloads folder.', type: 'success' });
    } catch (e) {
      if (!e?.message?.includes('cancel') && e?.name !== 'AbortError') {
        toast({ title: 'Could not share receipt. Please try again.', type: 'error' });
      }
    } finally {
      setLoading(null);
    }
  }

  function handleReportIssue() {
    const amtFmt = `₦${Number(data.amount || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const subject = `${data.title || "Transaction"} — ${amtFmt}${data.status ? ` [${data.status}]` : ""}`;
    const description = [
      `Transaction: ${data.title || ""}`,
      `Amount: ${amtFmt}`,
      `Status: ${data.status || "unknown"}`,
      ...(data.datetime ? [`Date: ${data.datetime}`] : []),
      ...(ref ? [`Reference: ${ref}`] : []),
      "",
      "Full Details:",
      ...fields
        .filter(f => !f.retrievable)
        .map(f => `  ${f.label}: ${f.value ?? "—"}`),
    ].join("\n");
    setTicketData({ subject, description });
    if (onReportIssue) onReportIssue({ ref, title, amount: data.amount, status: data.status });
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 flex items-end justify-center"
        style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      >
        {/* Bottom sheet */}
        <div
          className="w-full max-w-md flex flex-col bg-slate-100 dark:bg-slate-900 rounded-t-2xl overflow-hidden"
          style={{ maxHeight: '92dvh' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header — title + close */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate pr-2">{title}</p>
            <button
              onClick={onClose}
              className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-slate-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Scrollable body — full receipt + optional electricity section */}
          <div className="flex-1 overflow-y-auto">
            {/* Electricity token — async retrieval (token not yet known) */}
            {(retrievableField || onRetrieveToken) && onRetrieveToken && (
              <div className="px-4 pt-4 pb-1">
                <TokenSection onRetrieveToken={onRetrieveToken} />
              </div>
            )}
            {/* Electricity token — already stored (show immediately with copy) */}
            {data.elecToken && !onRetrieveToken && (
              <div className="px-4 pt-4 pb-1">
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-200 dark:border-amber-700 overflow-hidden">
                  <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                    <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">Electricity Token</p>
                    <button
                      onClick={() => { try { navigator.clipboard.writeText(data.elecToken); } catch (_) {} }}
                      className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 active:opacity-60"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="px-4 pb-4">
                    <p className="text-sm font-mono font-extrabold text-emerald-600 dark:text-emerald-400 tracking-widest break-all leading-relaxed">
                      {data.elecToken}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {/* Card details — WAEC / JAMB scratch cards */}
            {data.cardDetails && (
              <div className="px-4 pt-4 pb-1">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-200 dark:border-blue-700 overflow-hidden">
                  <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                    <p className="text-[10px] font-bold text-blue-700 dark:text-blue-300 uppercase tracking-widest">Card Details</p>
                    <button
                      onClick={() => { try { navigator.clipboard.writeText(data.cardDetails); } catch (_) {} }}
                      className="text-[10px] font-bold text-blue-600 dark:text-blue-400 active:opacity-60"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="px-4 pb-4">
                    <p className="text-sm font-mono font-bold text-slate-800 dark:text-slate-100 break-all leading-relaxed">
                      {data.cardDetails}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Full receipt card — exactly what will be shared / exported */}
            <div className="px-4 py-4">
              <ReceiptCard data={data} innerRef={receiptRef} />
            </div>
          </div>

          {/* Pinned bottom actions */}
          <div
            className="flex gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex-shrink-0"
            style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}
          >
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

      {shareOpen && <ShareSheet onOption={handleShare} onClose={() => setShareOpen(false)} />}
      {loading   && <LoadingOverlay label={loading === 'image' ? 'Preparing image…' : 'Preparing PDF…'} />}

      {ticketData && (
        <SupportTicketModal
          isOpen
          onClose={() => setTicketData(null)}
          subject={ticketData.subject}
          description={ticketData.description}
          type="payment"
          priority="high"
        />
      )}

    </>
  );
}
