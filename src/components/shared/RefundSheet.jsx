// Refund a recorded sale (owner, 2026-10-13). Gives money back to the customer — full or part of the sale, never more
// than what is still unrefunded — and, when the goods came back, returns them to stock. Saved as a transaction of
// category "refund" (type "out") linked to the sale by refund_of; it copies the sale's cost price, and `quantity` is the
// number of units returned to stock (0 = nothing came back). Profit rules R8 in src/shared/profitEngine.js:
// a refund lowers revenue (not an expense) and, for returned goods, takes their cost back out of COGS.
import { useMemo, useState } from "react";
import { BottomSheet } from "../WalletPanel";
import TransactionPinModal from "../TransactionPinModal";
import { fmt } from "../../utils/helpers";

const METHODS = [
  { id: "cash", label: "Cash" },
  { id: "transfer", label: "Transfer" },
  { id: "pos", label: "POS" },
];

export default function RefundSheet({ sale, refundedSoFar = 0, products = [], onRefund, onClose }) {
  const refundable = Math.max(0, (Number(sale?.amount) || 0) - refundedSoFar);
  const soldQty = sale?.line_items?.length ? null : (Number(sale?.quantity) || 1);
  const product = useMemo(() => {
    const name = String(sale?.item_name || "").toLowerCase().trim();
    return name ? products.find((p) => String(p.product_name || "").toLowerCase().trim() === name) || null : null;
  }, [sale, products]);
  const [amount, setAmount] = useState(String(refundable || ""));
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState(sale?.payment_type === "transfer" ? "transfer" : sale?.payment_type === "pos" ? "pos" : "cash");
  const [returned, setReturned] = useState(false);
  const [returnQty, setReturnQty] = useState(String(soldQty || 1));
  const [askPin, setAskPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const amt = parseFloat(amount) || 0;
  const qty = returned ? Math.max(0, Math.min(parseInt(returnQty, 10) || 0, soldQty || 0)) : 0;
  const valid = amt > 0 && amt <= refundable + 0.001 && reason.trim().length > 1 && (!returned || qty > 0);

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      await onRefund({
        amount: amt, reason: reason.trim(), payment_type: method,
        returnedQty: qty, product: returned ? product : null,
      });
      onClose();
    } catch (e) {
      setErr(e?.message || "Couldn't record the refund. Please try again.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <BottomSheet open onClose={onClose} title="Refund this sale">
        <div className="space-y-4">
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 px-4 py-3">
            <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{sale?.item_name || "Sale"}{sale?.customer_name ? ` · ${sale.customer_name}` : ""}</p>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">
              Sold for {fmt(sale?.amount || 0)}{refundedSoFar > 0 ? ` · ${fmt(refundedSoFar)} already refunded` : ""}
            </p>
          </div>
          {refundable <= 0 ? (
            <p className="text-sm text-slate-500">This sale has already been refunded in full.</p>
          ) : (
            <>
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Amount to refund</label>
                <div className="flex items-center gap-2 px-3.5 h-11 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800">
                  <span className="text-sm font-bold text-slate-400">₦</span>
                  <input type="number" inputMode="decimal" min="0" value={amount} onChange={(e) => setAmount(e.target.value)}
                    className="flex-1 bg-transparent text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Up to {fmt(refundable)}</p>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Reason</label>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Damaged item, wrong size"
                  className="w-full px-3.5 h-11 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-100 outline-none" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Paid back by</label>
                <div className="flex gap-2">
                  {METHODS.map((m) => (
                    <button key={m.id} type="button" onClick={() => setMethod(m.id)}
                      className={`flex-1 h-10 rounded-xl text-xs font-bold ${method === m.id ? "text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300"}`}
                      style={method === m.id ? { background: "var(--brand-green)" } : undefined}>{m.label}</button>
                  ))}
                </div>
              </div>
              {soldQty && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-3">
                  <label className="flex items-center justify-between gap-3">
                    <span>
                      <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Items returned to stock</span>
                      <span className="block text-[11px] text-slate-400">{product ? `Adds them back to ${product.product_name}` : "Counts them as returned (not in your stock list)"}</span>
                    </span>
                    <input type="checkbox" checked={returned} onChange={(e) => setReturned(e.target.checked)} className="w-5 h-5 accent-green-600" />
                  </label>
                  {returned && (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[12px] text-slate-500">How many?</span>
                      <input type="number" min="1" max={soldQty} value={returnQty} onChange={(e) => setReturnQty(e.target.value)}
                        className="w-20 px-2 h-9 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-center" />
                      <span className="text-[12px] text-slate-400">of {soldQty}</span>
                    </div>
                  )}
                </div>
              )}
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                A refund lowers your sales and profit for today. {returned ? "Returned items go back into your stock and their cost comes off your cost of goods." : "Without returned items, the whole refund comes off your profit."}
              </p>
              {err && <p className="text-[12px] text-red-500">{err}</p>}
              <button type="button" onClick={() => setAskPin(true)} disabled={!valid || busy}
                className="w-full h-12 rounded-xl text-white font-bold text-sm disabled:opacity-40" style={{ background: "#d97706" }}>
                {busy ? "Saving…" : `Refund ${fmt(amt || 0)}`}
              </button>
            </>
          )}
        </div>
      </BottomSheet>
      {askPin && (
        <TransactionPinModal title="Confirm Refund" amount={Math.round(amt * 100)} recipient={sale?.customer_name || undefined}
          description={reason.trim()} onApprove={() => { setAskPin(false); submit(); }} onCancel={() => setAskPin(false)} />
      )}
    </>
  );
}
