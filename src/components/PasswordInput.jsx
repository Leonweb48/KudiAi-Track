import { useState } from "react";

const EyeOpen = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOff = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden>
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

/**
 * PasswordInput — text input with a 44 × 44 px eye-toggle (ST-H01 compliant).
 *
 * Accepts all standard <input> props plus:
 *   accentClass  — Tailwind ring class for focus state (default "focus:ring-indigo-400/40")
 *   borderClass  — Tailwind border class (default neutral)
 */
export default function PasswordInput({
  value,
  onChange,
  placeholder = "Password",
  accentClass = "focus:ring-indigo-400/40",
  borderClass = "border-slate-200 dark:border-slate-700",
  className = "",
  ...rest
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`w-full border rounded-xl pl-4 pr-14 py-3 text-sm bg-white dark:bg-slate-900 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 transition ${borderClass} ${accentClass} ${className}`}
        {...rest}
      />
      {/* 44 × full-height tap target (ST-H01) */}
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-0 top-0 h-full w-11 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
      >
        {show ? <EyeOff /> : <EyeOpen />}
      </button>
    </div>
  );
}
