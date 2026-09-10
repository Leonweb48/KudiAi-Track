import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Searchable, mobile-friendly bank picker — a drop-in replacement for a native
 * <select> holding the full ~200-bank Paystack list. The trigger looks like the
 * app's other inputs; tapping it opens a full-screen sheet with a search box so
 * a member can type "gt" instead of scrolling a 200-row native wheel.
 *
 * Props:
 *   banks        [{ code, name }]  — raw Paystack list-banks payload
 *   value        string            — selected bank_code
 *   onChange     (code, bank)      — fires with the picked code + { code, name }
 *   disabled     boolean
 *   placeholder  string
 *   className    string            — extra classes for the trigger button
 */

// Names a Nigerian user is most likely to want — floated to the top when the
// search box is empty. Matched loosely (case-insensitive substring) so minor
// list wording differences ("GTBank" vs "Guaranty Trust Bank") still catch.
const POPULAR = ["opay", "palmpay", "kuda", "moniepoint", "guaranty trust", "gtbank", "access bank", "first bank", "united bank for africa", "zenith bank"];

export default function BankSelect({
  banks = [],
  value = "",
  onChange,
  disabled = false,
  placeholder = "Select bank…",
  className = "",
}) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);

  // Dedupe by code, then alphabetical.
  const cleanBanks = useMemo(() => {
    const seen = new Set();
    return banks
      .filter(b => b?.code && b?.name && !seen.has(b.code) && seen.add(b.code))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [banks]);

  const selected = cleanBanks.find(b => b.code === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const pop = [];
      const rest = [];
      for (const b of cleanBanks) {
        (POPULAR.some(p => b.name.toLowerCase().includes(p)) ? pop : rest).push(b);
      }
      return { pop, rest };
    }
    return { pop: [], rest: cleanBanks.filter(b => b.name.toLowerCase().includes(q)) };
  }, [cleanBanks, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    const onKey = e => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const pick = (bank) => {
    onChange?.(bank.code, bank);
    setOpen(false);
  };

  const rowCls = (isSel) =>
    `w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold transition ${
      isSel
        ? "bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300"
        : "text-slate-700 dark:text-slate-200 active:bg-slate-100 dark:active:bg-slate-700/50"
    }`;

  const Check = () => (
    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 flex-shrink-0 text-brand-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`w-full flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-50 ${
          selected ? "text-slate-700 dark:text-slate-200" : "text-slate-400 dark:text-slate-500"
        } ${className}`}
      >
        <span className="truncate min-w-0">{selected ? selected.name : (cleanBanks.length === 0 ? "Loading banks…" : placeholder)}</span>
        <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 flex-shrink-0 text-slate-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60"
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div role="dialog" aria-modal="true" aria-label="Select bank"
            className="w-full max-w-md bg-white dark:bg-slate-800 rounded-t-3xl shadow-2xl flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <p className="font-extrabold text-slate-800 dark:text-white">Select bank</p>
              <button type="button" onClick={() => setOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="px-5 pb-3">
              <div className="flex items-center gap-2 h-11 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40 px-3">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 flex-shrink-0 text-slate-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search your bank"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="flex-1 bg-transparent text-sm font-semibold text-slate-700 dark:text-slate-200 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
                {query && (
                  <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }}
                    className="text-slate-400 flex-shrink-0">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
              {filtered.pop.length === 0 && filtered.rest.length === 0 && (
                <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-10">
                  {cleanBanks.length === 0 ? "Loading banks…" : "No banks match your search"}
                </p>
              )}
              {filtered.pop.length > 0 && (
                <>
                  <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Common</p>
                  {filtered.pop.map(b => (
                    <button key={b.code} type="button" onClick={() => pick(b)} className={rowCls(b.code === value)}>
                      <span className="truncate">{b.name}</span>
                      {b.code === value && <Check />}
                    </button>
                  ))}
                  <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">All banks</p>
                </>
              )}
              {filtered.rest.map(b => (
                <button key={b.code} type="button" onClick={() => pick(b)} className={rowCls(b.code === value)}>
                  <span className="truncate">{b.name}</span>
                  {b.code === value && <Check />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
