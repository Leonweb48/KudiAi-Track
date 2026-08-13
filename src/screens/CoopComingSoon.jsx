import { supabase } from "../utils/supabase";

export default function CoopComingSoon() {
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  return (
    <div className="h-[100dvh] flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900 px-8 text-center">
      <div className="w-20 h-20 rounded-3xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-6 shadow-sm">
        <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10 text-green-600 dark:text-green-400" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </div>

      <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white mb-3 tracking-tight">
        Cooperative Management
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-xs mb-10">
        We're putting the finishing touches on cooperative management.
        We'll let you know as soon as it's ready.
      </p>

      <button
        onClick={handleSignOut}
        className="text-sm font-semibold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors py-2 px-4"
      >
        Sign out
      </button>
    </div>
  );
}
