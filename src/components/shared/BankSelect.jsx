import { useEffect, useId, useMemo, useRef, useState } from "react";
import NetworkBars from "./NetworkBars";
import BankLogo from "./BankLogo";

/**
 * Type-to-search bank picker — a drop-in replacement for a native <select> holding the full ~200-bank list.
 *
 * It is a text box IN the form (2026-10-22, owner: the pop-up sheet was inconvenient and got messy on phones — the keyboard
 * covered most of it): tap it, type "gt" or "opay", and the matching banks (with their logos) appear right under the box;
 * tap one to pick it. The list sits in the page flow, not floating, so a scrolling sheet or modal never clips it.
 *
 * Props:
 *   banks        [{ code, name }]  — raw list-banks payload
 *   value        string            — selected bank_code
 *   onChange     (code, bank)      — fires with the picked code + { code, name }
 *   disabled     boolean
 *   placeholder  string
 *   className    string            — extra classes for the box (height, margin…)
 *   network      { [code]: "good" | "fair" | "poor" | "unknown" } — optional; signal bars per bank (transfer screen)
 */

// Names a Nigerian user is most likely to want — shown first while the box is empty. Matched loosely (case-insensitive
// substring) so list wording differences ("GTBank" vs "Guaranty Trust Bank") still catch.
const POPULAR = ["opay", "palmpay", "kuda", "moniepoint", "guaranty trust", "gtbank", "access bank", "first bank", "united bank for africa", "zenith bank"];

// Short forms people type for banks whose list name doesn't contain them.
const ALIASES = { gtb: "guaranty trust", gtbank: "guaranty trust", gtco: "guaranty trust", uba: "united bank for africa", fbn: "first bank", fcmb: "first city monument", alat: "wema", palm: "palmpay" };

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export default function BankSelect({
  banks = [],
  value = "",
  onChange,
  disabled = false,
  placeholder = "Select bank…",
  className = "",
  network = null,
}) {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState("");
  const [active, setActive] = useState(0);
  const wrapRef  = useRef(null);
  const inputRef = useRef(null);
  const listRef  = useRef(null);
  const listId   = useId();

  // Dedupe by code, then alphabetical.
  const cleanBanks = useMemo(() => {
    const seen = new Set();
    return banks
      .filter(b => b?.code && b?.name && !seen.has(b.code) && seen.add(b.code))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [banks]);

  const selected = cleanBanks.find(b => b.code === value) || null;

  // Empty box: common banks first, then all. Typed: banks with a word starting with it first, then any that contain it
  // (or match a short form like "gtb" / "uba").
  const shown = useMemo(() => {
    const q = norm(query);
    if (!q) {
      const pop = [], rest = [];
      for (const b of cleanBanks) (POPULAR.some(p => b.name.toLowerCase().includes(p)) ? pop : rest).push(b);
      return { pop, rest };
    }
    const alias = ALIASES[q.replace(/ /g, "")];
    const starts = [], contains = [];
    for (const b of cleanBanks) {
      const n = norm(b.name);
      if (n.startsWith(q) || n.split(" ").some(w => w.startsWith(q))) starts.push(b);
      else if (n.includes(q) || (alias && n.includes(alias))) contains.push(b);
    }
    return { pop: [], rest: [...starts, ...contains] };
  }, [cleanBanks, query]);
  const flat = useMemo(() => [...shown.pop, ...shown.rest], [shown]);

  const close = () => { setOpen(false); setQuery(""); };

  // Close when the user taps anywhere else.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQuery(""); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("touchstart", onDown); };
  }, [open]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {   // keep the highlighted row visible while arrowing through the list
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    setQuery("");
    // bring the box near the top so the list under it isn't hidden behind the phone keyboard
    setTimeout(() => wrapRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }), 250);
  };
  const pick = (bank) => {
    onChange?.(bank.code, bank);
    close();
    inputRef.current?.blur();
  };

  const onKeyDown = (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { openList(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[active]) pick(flat[active]); }
    else if (e.key === "Escape") { close(); inputRef.current?.blur(); }
  };

  const row = (b, idx) => {
    const isSel = b.code === value, isAct = idx === active;
    return (
      <button key={b.code} type="button" data-idx={idx} role="option" aria-selected={isSel}
        // keep the focus in the box while tapping a row (no keyboard flicker); the pick happens on click
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => pick(b)}
        onMouseEnter={() => setActive(idx)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm font-semibold transition ${
          isSel ? "text-brand-700 dark:text-brand-300" : "text-slate-700 dark:text-slate-200"
        } ${isAct ? "bg-slate-100 dark:bg-slate-700/60" : isSel ? "bg-brand-50 dark:bg-brand-900/20" : ""}`}>
        <BankLogo code={b.code} name={b.name} size={28} radius={8} />
        <span className="truncate flex-1 min-w-0">{b.name}</span>
        <span className="flex items-center gap-2 flex-shrink-0">
          <NetworkBars status={network?.[b.code]} />
          {isSel && (
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-brand-500" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          )}
        </span>
      </button>
    );
  };

  const showNetHint = network && Object.values(network).some((v) => v !== "unknown");

  return (
    <div ref={wrapRef} className="w-full">
      <div
        onClick={() => { if (!open) { openList(); inputRef.current?.focus(); } }}
        className={`w-full flex items-center gap-2 rounded-xl border bg-white dark:bg-slate-800 px-3 text-sm font-semibold ${
          open ? "border-brand-400 ring-2 ring-brand-500/30" : "border-slate-200 dark:border-slate-600"
        } ${disabled ? "opacity-50 pointer-events-none" : "cursor-text"} ${className}`}>
        {!open && selected
          ? <BankLogo code={selected.code} name={selected.name} size={24} radius={7} />
          : <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 flex-shrink-0 text-slate-400" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={placeholder}
          disabled={disabled}
          value={open ? query : (selected ? selected.name : "")}
          onChange={(e) => { if (!open) setOpen(true); setQuery(e.target.value); }}
          onFocus={() => { if (!open) openList(); }}
          onKeyDown={onKeyDown}
          placeholder={open ? (selected ? selected.name : "Type your bank's name") : (cleanBanks.length === 0 ? "Loading banks…" : placeholder)}
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
          className="flex-1 min-w-0 self-stretch bg-transparent outline-none text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500"
        />
        {!open && selected && <NetworkBars status={network?.[selected.code]} />}
        {open && query
          ? <button type="button" aria-label="Clear" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); setQuery(""); inputRef.current?.focus(); }} className="text-slate-400 flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          : <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 flex-shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>}
      </div>

      {open && (
        <div role="listbox" id={listId} ref={listRef}
          className="mt-1.5 max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg">
          {showNetHint && (
            <p className="px-3 pt-2 pb-1 text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
              <NetworkBars status="good" /> Bars show how transfers to each bank are going right now
            </p>
          )}
          {flat.length === 0 && (
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6">
              {cleanBanks.length === 0 ? "Loading banks…" : "No banks match — check the spelling"}
            </p>
          )}
          {shown.pop.length > 0 && (
            <>
              <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Common</p>
              {shown.pop.map((b, i) => row(b, i))}
              <p className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">All banks</p>
            </>
          )}
          {shown.rest.map((b, i) => row(b, shown.pop.length + i))}
        </div>
      )}
    </div>
  );
}
