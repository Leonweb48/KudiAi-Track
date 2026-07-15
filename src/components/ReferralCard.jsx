import { useState } from "react";
import { useReferrals } from "../hooks/useReferrals";

function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 12 20 22 4 22 4 12"/>
      <rect x="2" y="7" width="20" height="5"/>
      <line x1="12" y1="22" x2="12" y2="7"/>
      <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/>
      <path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/>
    </svg>
  );
}

export default function ReferralCard() {
  const { myCode, referrals, config, loading } = useReferrals();
  const [copied, setCopied] = useState(false);

  if (loading) return null;
  if (!myCode) return null;

  const qualified = referrals.filter(r => r.qualified_at != null).length;
  const pending   = referrals.length - qualified;

  const rewardLabel = config
    ? config.reward_type === "cash"
      ? `₦${Number(config.reward_value || 0).toLocaleString()}`
      : config.reward_type === "percentage"
      ? `${config.reward_value}% off`
      : config.reward_value
        ? String(config.reward_value)
        : null
    : null;

  const shareText = `Join me on KudiAI Track and grow your business smarter! Use my referral code ${myCode.code} when signing up. https://kudiai.app`;

  const handleCopy = () => {
    navigator.clipboard?.writeText(myCode.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({ title: "Join KudiAI Track", text: shareText }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl p-4 shadow-card border border-slate-100 dark:border-slate-700/50">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0 text-green-600 dark:text-green-400">
          <GiftIcon />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 dark:text-white leading-tight">Refer &amp; Earn</p>
          {rewardLabel && (
            <p className="text-[11px] text-green-600 dark:text-green-400 font-semibold">
              Earn {rewardLabel} per qualified referral
            </p>
          )}
        </div>
      </div>

      {/* Code row */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 bg-slate-50 dark:bg-slate-700/60 rounded-xl px-3 py-2 font-mono text-base font-extrabold text-slate-800 dark:text-white tracking-[0.2em] text-center select-all">
          {myCode.code}
        </div>
        <button
          onClick={handleCopy}
          className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 active:scale-90 transition-transform flex-shrink-0">
          <CopyIcon />
        </button>
      </div>

      {copied && (
        <p className="text-[11px] text-green-600 dark:text-green-400 font-semibold text-center mb-2">
          Copied!
        </p>
      )}

      {/* Stats row */}
      {referrals.length > 0 && (
        <div className="flex gap-3 mb-3">
          <div className="flex-1 bg-slate-50 dark:bg-slate-700/40 rounded-xl px-3 py-2 text-center">
            <p className="text-base font-extrabold text-slate-800 dark:text-white">{referrals.length}</p>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">Referred</p>
          </div>
          <div className="flex-1 bg-green-50 dark:bg-green-900/20 rounded-xl px-3 py-2 text-center">
            <p className="text-base font-extrabold text-green-600 dark:text-green-400">{qualified}</p>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">Qualified</p>
          </div>
          {pending > 0 && (
            <div className="flex-1 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2 text-center">
              <p className="text-base font-extrabold text-amber-600 dark:text-amber-400">{pending}</p>
              <p className="text-[10px] text-slate-400 font-medium mt-0.5">Pending</p>
            </div>
          )}
        </div>
      )}

      {/* Share button */}
      <button
        onClick={handleShare}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm text-white active:scale-95 transition-transform bg-[linear-gradient(135deg,#16a34a,#059669)]">
        <ShareIcon />
        Share Your Code
      </button>
    </div>
  );
}
