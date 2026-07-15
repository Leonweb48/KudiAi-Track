/**
 * AuthShell — shared wrapper for all auth, first-login, and onboarding screens.
 *
 * variant="card"  full-screen centred layout; OTP / verify flows
 * variant="page"  top-header + scrollable body; set-password / onboarding
 */

export function AuthShell({ variant = "card", children, className = "" }) {
  if (variant === "card") {
    return (
      <div
        className={`fixed inset-0 flex flex-col items-center justify-center p-5 bg-slate-50 dark:bg-slate-950 ${className}`}
        style={{ paddingTop: "max(20px, env(safe-area-inset-top, 20px))" }}
      >
        <div className="w-full max-w-[360px]">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col ${className}`}>
      {children}
    </div>
  );
}

/**
 * AuthPageHeader — sticky top header for the "page" variant.
 * accent="green"   uses dark:bg-[#0b120e] / dark:border-[#162218]
 * accent="indigo"  uses dark:bg-[#0e1117] / dark:border-[#1e2433]
 */
export function AuthPageHeader({ children, accent = "indigo", className = "" }) {
  const dark = accent === "green"
    ? "dark:bg-[#0b120e] dark:border-[#162218]"
    : "dark:bg-[#0e1117] dark:border-[#1e2433]";

  return (
    <div
      className={`bg-white ${dark} border-b border-slate-100 px-5 pb-6 ${className}`}
      style={{ paddingTop: "max(56px, env(safe-area-inset-top, 56px))" }}
    >
      {children}
    </div>
  );
}

/**
 * AuthCard — the frosted card used inside the "card" variant.
 * accent="green"   uses dark:bg-[#0b120e] / dark:border-[#162218]
 * accent="indigo"  uses dark:bg-[#0e1117] / dark:border-[#1e2433]
 */
export function AuthCard({ children, accent = "indigo", className = "" }) {
  const dark = accent === "green"
    ? "dark:bg-[#0b120e] dark:border-[#162218]"
    : "dark:bg-[#0e1117] dark:border-[#1e2433]";

  return (
    <div
      className={`rounded-2xl p-6 bg-white ${dark} border border-slate-200 shadow-2xl dark:shadow-[0_25px_50px_rgba(0,0,0,0.5)] ${className}`}
    >
      {children}
    </div>
  );
}
