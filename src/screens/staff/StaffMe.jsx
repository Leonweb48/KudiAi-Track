import { useState, useEffect, useRef } from "react";
import { supabase } from "../../utils/supabase";
import Modal from "../../components/shared/Modal";
import { StaffActivityStatement } from "../../components/shared/Receipt";
import StaffReports from "../StaffReports";
import Insights from "../Insights";
import {
  Svg, P, NK, GK, YEAR,
  SectionLabel, SettingsCard, Row, RowIcon,
  ChangePinModal, SupportModal, FAQ,
  uploadAvatar,
} from "./StaffShared";

/* ═══════════════════════════════════════════════════════════════════
   ME TAB
═══════════════════════════════════════════════════════════════════ */
export default function StaffMe({ staff, session, store, inventory, livePerms, staffId, pinLock, plan, initialView, onStaffUpdate }) {
  const [view,              setView]              = useState(initialView || "menu");
  const [isDark,            setIsDark]            = useState(() => localStorage.getItem("kuditrack_dark") === "1");
  const [editForm,          setEditForm]          = useState({ full_name: staff?.full_name || "", phone: staff?.phone || "" });
  const [photoFile,         setPhotoFile]         = useState(null);
  const [photoPreview,      setPhotoPreview]      = useState(null);
  const [saving,            setSaving]            = useState(false);
  const [saveMsg,           setSaveMsg]           = useState("");
  const [changingPin,       setChangingPin]       = useState(null);
  const [bioLoading,        setBioLoading]        = useState(false);
  const [showTimeoutPicker, setShowTimeoutPicker] = useState(false);
  const [showSupport,       setShowSupport]       = useState(false);
  const [showStatement,     setShowStatement]     = useState(false);
  const [showReports,       setShowReports]       = useState(false);
  const fileRef = useRef(null);

  useEffect(() => { if (initialView) setView(initialView); }, [initialView]);

  const initials = (staff?.full_name || "S").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem("kuditrack_dark", next ? "1" : "0");
    document.documentElement.classList.toggle("dark", next);
  };

  const saveProfile = async () => {
    setSaving(true); setSaveMsg("");
    try {
      let photoUrl = staff?.profile_image_url;
      if (photoFile) photoUrl = await uploadAvatar(photoFile, staffId);
      await supabase.from("staff").update({ full_name: editForm.full_name, phone: editForm.phone, profile_image_url: photoUrl }).eq("id", staffId);
      setPhotoFile(null); setPhotoPreview(null);
      onStaffUpdate?.({ full_name: editForm.full_name, phone: editForm.phone, profile_image_url: photoUrl });
      setSaveMsg("Profile saved!");
      setTimeout(() => { setSaveMsg(""); setView("menu"); }, 1500);
    } catch { setSaveMsg("Save failed. Please try again."); }
    setSaving(false);
  };

  /* Back-button sub-header — rounded-full per design spec */
  const SubHeader = ({ title }) => (
    <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-100 dark:border-slate-700/50 flex-shrink-0 bg-white dark:bg-slate-900">
      <button onClick={() => setView("menu")}
        className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition"
        style={{ backgroundColor: "#E8F7E3" }}>
        <div style={{ color: NK }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
          </svg>
        </div>
      </button>
      <p className="text-base font-extrabold text-slate-800 dark:text-slate-100">{title}</p>
    </div>
  );

  /* ── FAQ sub-view ── */
  if (view === "faq") return (
    <div className="h-full flex flex-col">
      <SubHeader title="Frequently Asked Questions" />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-6"><FAQ /></div>
    </div>
  );

  /* ── Reports sub-view ── */
  if (view === "reports") return (
    <div className="h-full flex flex-col">
      {showReports && (
        <StaffReports
          store={store}
          inventory={inventory}
          staffName={staff?.full_name}
          businessName={staff?.business_name || store.profile?.business_name}
          onClose={() => setShowReports(false)}
        />
      )}
      <SubHeader title="Reports & Insights" />
      <div className="flex-1 overflow-y-auto pb-4">
        <Insights store={store} inventory={inventory} plan={plan || "starter"} onUpgrade={null} onReports={() => setShowReports(true)} />
      </div>
    </div>
  );

  /* ── Edit profile sub-view ── */
  if (view === "edit") return (
    <div className="h-full flex flex-col">
      <SubHeader title="Edit Profile" />
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 pb-6">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-24 h-24 rounded-3xl flex items-center justify-center shadow-lg overflow-hidden"
              style={{ backgroundColor: NK }}>
              {photoPreview
                ? <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                : staff?.profile_image_url
                  ? <img src={staff.profile_image_url} alt="" className="w-full h-full object-cover" />
                  : <span className="text-2xl font-black text-white">{initials}</span>}
            </div>
            <button onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center shadow-md active:scale-90 transition"
              style={{ backgroundColor: GK }}>
              <Svg d={P.cam} size={15} color="#fff" />
            </button>
          </div>
          <p className="text-[12px] text-slate-400">Tap camera to change photo</p>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (!f) return; setPhotoFile(f); setPhotoPreview(URL.createObjectURL(f)); }} />
        </div>
        <div className="space-y-3">
          {[["Full Name","full_name","text"],["Phone","phone","tel"]].map(([l, k, tp]) => (
            <div key={k}>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">{l}</p>
              <input type={tp} value={editForm[k]} onChange={e => setEditForm(p => ({...p, [k]: e.target.value}))}
                className="w-full h-12 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
            </div>
          ))}
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 px-1">Email</p>
            <input disabled value={staff?.email || session?.user?.email || "—"}
              className="w-full h-12 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 text-sm text-slate-400 cursor-not-allowed" />
          </div>
        </div>
        {saveMsg && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl ${saveMsg.includes("saved") ? "" : "bg-red-50 dark:bg-red-900/30 text-red-600"}`}
            style={saveMsg.includes("saved") ? { backgroundColor: "#E8F7E3", color: GK } : {}}>
            <Svg d={saveMsg.includes("saved") ? P.check : P.alert} size={16} color="currentColor" />
            <p className="text-sm font-semibold">{saveMsg}</p>
          </div>
        )}
        <button onClick={saveProfile} disabled={saving}
          className="w-full h-12 rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-50"
          style={{ backgroundColor: GK }}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );

  /* ── Toggle helper ── */
  function Toggle({ on, onToggle }) {
    return (
      <button onClick={e => { e.stopPropagation(); onToggle(); }}
        className="relative w-12 h-6 rounded-full flex-shrink-0 transition-colors duration-200"
        style={{ backgroundColor: on ? GK : "#e2e8f0" }}>
        <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200"
          style={{ left: on ? "calc(100% - 22px)" : "2px" }} />
      </button>
    );
  }

  /* ── Main Me menu ── */
  return (
    <div className="h-full overflow-y-auto pb-4">

      {/* Profile card with navy accent band */}
      <div className="mx-4 mt-5 mb-5">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-card border border-slate-100 dark:border-slate-700/50 overflow-hidden">
          <div className="h-12" style={{ background: `linear-gradient(135deg, ${NK} 0%, #1e3370 100%)` }} />
          <div className="px-5 pb-5 -mt-6 flex items-end gap-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg flex-shrink-0 overflow-hidden border-2 border-white dark:border-slate-800"
              style={{ backgroundColor: NK }}>
              {staff?.profile_image_url
                ? <img src={staff.profile_image_url} alt="" className="w-full h-full object-cover" />
                : <span className="text-xl font-black text-white">{initials}</span>}
            </div>
            <div className="flex-1 min-w-0 pt-7">
              <p className="text-base font-extrabold text-slate-800 dark:text-slate-100 truncate">{staff?.full_name || "Staff"}</p>
              <p className="text-[12px] font-bold capitalize mt-0.5" style={{ color: GK }}>{staff?.role || "Staff Member"}</p>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate">{staff?.business_name || "—"}</p>
            </div>
            <button onClick={() => setView("edit")}
              className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition flex-shrink-0 self-end mb-0.5"
              style={{ backgroundColor: "#E8F7E3" }}>
              <div style={{ color: NK }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Account */}
      <div className="px-4 mb-5">
        <SectionLabel>Account</SectionLabel>
        <SettingsCard>
          <Row icon={<RowIcon d={P.person} />} label="Edit Profile"       sub="Update your name, phone, and photo" onClick={() => setView("edit")} />
          <Row icon={<RowIcon d={P.report} />} label="Reports & Insights" sub="View your performance analytics"    onClick={() => setView("reports")} />
          <Row icon={<RowIcon d={P.doc} />}    label="Activity Statement" sub="Generate & share your statement"    onClick={() => setShowStatement(true)} />
        </SettingsCard>
      </div>

      {/* Security */}
      <div className="px-4 mb-5">
        <SectionLabel>Security</SectionLabel>
        <SettingsCard>
          <Row icon={<RowIcon d={P.lock} />}   label="Change App Lock PIN"     sub="6-digit PIN · unlocks the app"   onClick={() => setChangingPin("app")} />
          <Row icon={<RowIcon d={P.shield} />} label="Change Transaction PIN"  sub="4-digit PIN · confirms payments" onClick={() => setChangingPin("txn")} />
          {pinLock.biometricAvailable && (
            <Row
              icon={<RowIcon d={P.finger} />}
              label="Face / Fingerprint"
              sub={pinLock.biometricEnabled ? "Enabled — tap to disable" : "Tap to enable biometric unlock"}
              onClick={async () => {
                setBioLoading(true);
                if (pinLock.biometricEnabled) await pinLock.disableBiometric();
                else await pinLock.registerBiometric();
                setBioLoading(false);
              }}
              right={
                bioLoading
                  ? <div className="w-4 h-4 rounded-full animate-spin border-2 border-transparent"
                      style={{ borderTopColor: GK }} />
                  : <Toggle on={pinLock.biometricEnabled} onToggle={async () => {
                      setBioLoading(true);
                      if (pinLock.biometricEnabled) await pinLock.disableBiometric();
                      else await pinLock.registerBiometric();
                      setBioLoading(false);
                    }} />
              }
            />
          )}
          <Row
            icon={<RowIcon d={P.shield} />}
            label="Auto-lock"
            sub={({ 0: "Never", 60: "1 minute", 300: "5 minutes", 900: "15 minutes", 1800: "30 minutes" })[pinLock.autoLockTimeout] || `${Math.round(pinLock.autoLockTimeout / 60)} min`}
            onClick={() => setShowTimeoutPicker(true)}
          />
        </SettingsCard>
      </div>

      {/* Preferences */}
      <div className="px-4 mb-5">
        <SectionLabel>Preferences</SectionLabel>
        <SettingsCard>
          <Row
            icon={<RowIcon d={isDark ? P.moon : P.sun} />}
            label="Dark Mode"
            onClick={toggleDark}
            right={<Toggle on={isDark} onToggle={toggleDark} />}
          />
        </SettingsCard>
      </div>

      {/* Help & Support */}
      <div className="px-4 mb-5">
        <SectionLabel>Help & Support</SectionLabel>
        <SettingsCard>
          <Row icon={<RowIcon d={P.faq} />}  label="Frequently Asked Questions" sub="Browse common questions"  onClick={() => setView("faq")} />
          <Row icon={<RowIcon d={P.help} />} label="Contact Support"            sub="Submit a support ticket"  onClick={() => setShowSupport(true)} />
        </SettingsCard>
      </div>

      {/* Sign Out */}
      <div className="px-4 mb-4">
        <button onClick={() => supabase.auth.signOut()}
          className="w-full py-[15px] bg-red-50 dark:bg-red-950/30 rounded-2xl font-bold text-sm border border-red-100 dark:border-red-900/40 active:bg-red-100 transition-colors flex items-center justify-center gap-2.5 text-red-500 dark:text-red-400">
          <Svg d={P.out2} size={18} color="currentColor" />
          Sign Out
        </button>
      </div>

      {/* Footer */}
      <div className="text-center py-4 px-8 space-y-1">
        <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">KudiAI Track · Staff Portal</p>
        <p className="text-[10px] text-slate-300 dark:text-slate-600">Powered by AMAYA & Co. Technologies<br />All rights reserved © {YEAR}</p>
      </div>

      {/* Modals */}
      {changingPin && (
        <ChangePinModal
          mode={changingPin}
          onClose={() => setChangingPin(null)}
          onDone={async (current, newP) => {
            await (changingPin === "app" ? pinLock.changeAppPin : pinLock.changeTxnPin)(current, newP);
          }}
        />
      )}
      {showTimeoutPicker && (
        <Modal title="Auto-lock Timeout" onClose={() => setShowTimeoutPicker(false)}>
          <div className="space-y-2 py-2">
            {[[0,"Never"],[60,"1 minute"],[300,"5 minutes (recommended)"],[900,"15 minutes"],[1800,"30 minutes"]].map(([v, l]) => (
              <button key={v}
                onClick={async () => { await pinLock.updateSettings({ autoLockTimeout: v }); setShowTimeoutPicker(false); }}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition text-sm font-semibold ${
                  pinLock.autoLockTimeout === v ? "text-white" : "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                }`}
                style={pinLock.autoLockTimeout === v ? { backgroundColor: NK } : {}}>
                {l}
                {pinLock.autoLockTimeout === v && <Svg d={P.check} size={16} color="#fff" sw={2.5} />}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {showSupport && (
        <SupportModal onClose={() => setShowSupport(false)} staffName={staff?.full_name} staffEmail={staff?.email || session?.user?.email || ""} />
      )}
      {showStatement && (
        <StaffActivityStatement store={store} staffName={staff?.full_name} businessName={staff?.business_name || store.profile?.business_name} onClose={() => setShowStatement(false)} />
      )}
    </div>
  );
}
