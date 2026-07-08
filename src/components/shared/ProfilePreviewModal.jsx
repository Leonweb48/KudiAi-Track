import { useNavigate } from "react-router-dom";
import { getPlanInfo } from "../../utils/plans";

export default function ProfilePreviewModal({ profile, plan, onClose }) {
  const navigate = useNavigate();
  const initials = (profile.business_name || profile.owner_name || "?")[0].toUpperCase();
  const { name: planName, sortOrder: planTier } = getPlanInfo(plan || "free");

  const planBadgeStyle = planTier >= 2
    ? { background: "#1B2A5E18", color: "#1B2A5E" }
    : planTier >= 1
    ? { background: "#1d4ed818", color: "#1d4ed8" }
    : { background: "#64748b12", color: "#64748b" };

  const goEdit = () => { onClose(); navigate("/profile"); };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex flex-col justify-end"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 w-full max-w-lg mx-auto rounded-t-3xl overflow-hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700" />
        </div>

        {/* Avatar + name */}
        <div className="flex flex-col items-center px-6 pt-4 pb-5 text-center">
          <div className="w-20 h-20 rounded-2xl overflow-hidden mb-3 border-2 border-slate-100 dark:border-slate-700 shadow-md">
            {profile.profile_image_url
              ? <img src={profile.profile_image_url} alt="Profile" className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-3xl">
                  {initials}
                </div>
            }
          </div>
          <p className="text-xl font-black text-slate-800 dark:text-white leading-tight">
            {profile.business_name || profile.owner_name || "Business"}
          </p>
          {profile.business_name && profile.owner_name && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{profile.owner_name}</p>
          )}
          {plan && (
            <span
              className="inline-block mt-2 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full"
              style={planBadgeStyle}
            >
              {planName}
            </span>
          )}
        </div>

        {/* Contact info */}
        {(profile.phone || profile.email) && (
          <div className="mx-4 bg-slate-50 dark:bg-slate-800 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-700 mb-4 border border-slate-100 dark:border-slate-700/50">
            {profile.phone && (
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-xl bg-green-50 dark:bg-green-900/20 flex items-center justify-center flex-shrink-0">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .82h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Phone</p>
                  <p className="text-sm font-bold text-slate-800 dark:text-white">{profile.phone}</p>
                </div>
              </div>
            )}
            {profile.email && (
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Email</p>
                  <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{profile.email}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="px-4 pb-6 flex gap-2.5">
          <button
            onClick={onClose}
            className="flex-1 py-3.5 rounded-2xl text-sm font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 active:scale-95 transition"
          >
            Close
          </button>
          <button
            onClick={goEdit}
            className="flex-1 py-3.5 rounded-2xl text-sm font-bold text-white active:scale-95 transition"
            style={{ background: "linear-gradient(135deg,#059669,#047857)" }}
          >
            Edit Profile
          </button>
        </div>
      </div>
    </div>
  );
}
