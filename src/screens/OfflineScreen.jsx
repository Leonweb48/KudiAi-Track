import AppLogo from "../components/AppLogo";

export default function OfflineScreen({ onRetry }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-900 px-6 text-center">
      <div className="mb-6">
        <AppLogo className="h-10 mx-auto" />
      </div>

      {/* Cloud-slash icon */}
      <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-5">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
          strokeLinecap="round" strokeLinejoin="round"
          className="w-8 h-8 text-slate-400 dark:text-slate-500">
          <path d="M3 3l18 18" />
          <path d="M8.5 8.5A5 5 0 0 0 7 18h11a4 4 0 0 0 .78-7.93" />
          <path d="M12 2a5 5 0 0 1 4.95 4.35" />
        </svg>
      </div>

      <h1 className="text-xl font-extrabold text-slate-800 dark:text-white mb-2">
        Can&#39;t connect
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs mb-8 leading-relaxed">
        Check your internet connection and tap Retry. Your account is safe — you&#39;ll be taken straight to your portal once you&#39;re back online.
      </p>

      <button
        onClick={onRetry}
        className="px-8 py-3 bg-green-600 text-white rounded-2xl font-bold text-sm active:scale-95 transition-transform shadow-sm">
        Retry
      </button>
    </div>
  );
}
