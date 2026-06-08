import { useState, useEffect } from "react";
import Icon   from "../components/Icon";
import Modal  from "../components/shared/Modal";
import Field  from "../components/shared/Field";
import Badge  from "../components/shared/Badge";
import { CreditReceipt } from "../components/shared/Receipt";
import { ClientProfile }  from "../components/shared/ClientProfile";
import { STATES, getLGAs, getWards } from "../utils/nigeriaData";
import { supabase } from "../utils/supabase";
import { fmt } from "../utils/helpers";

const BLANK = {
  customer_name: "", total_amount: "", due_date: "", notes: "",
  phone: "", email: "", nin: "",
  address: "", state: "", lga: "", ward: "",
  next_of_kin: "", next_of_kin_phone: "", next_of_kin_email: "", next_of_kin_address: "",
};

function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-5 mb-2">
      {children}
    </p>
  );
}

async function uploadPhoto(file, id, bucket = "avatars", folder = "credit") {
  const path = `clients/${folder}/${id}`;
  await supabase.storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type });
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export default function Credit({ store, plan = "starter", autoOpen, onAutoOpened, onUpgrade }) {
  const [showAdd,      setShowAdd]      = useState(false);
  const [repaying,     setRepaying]     = useState(null);
  const [repayAmt,     setRepayAmt]     = useState("");
  const [receipt,      setReceipt]      = useState(null);
  const [profile_,     setProfile_]     = useState(null);
  const [photoFile,    setPhotoFile]    = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [adding,       setAdding]       = useState(false);

  const { credits, addCredit, repayCredit, updateCredit, profile, staffMap = {} } = store;

  const [f, setF] = useState(BLANK);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const lgas  = getLGAs(f.state);
  const wards = getWards(f.state, f.lga);

  useEffect(() => {
    if (autoOpen) { setShowAdd(true); onAutoOpened?.(); }
  }, [autoOpen, onAutoOpened]);

  const totalOut = credits.reduce((s, c) => s + c.outstanding, 0);
  const overdue  = credits.filter(c => c.status === "overdue").length;

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const resetAdd = () => {
    setShowAdd(false); setF(BLANK);
    setPhotoFile(null); setPhotoPreview(null);
  };

  const handleAdd = async () => {
    if (!f.customer_name || !f.total_amount) return;
    setAdding(true);
    const { data, error } = await addCredit({ ...f, total_amount: parseFloat(f.total_amount) });
    if (!error && data && photoFile) {
      try {
        const url = await uploadPhoto(photoFile, data.id, "avatars", "credit");
        await updateCredit(data.id, { profile_image_url: url });
      } catch (err) {
        console.error("Photo upload:", err);
      }
    }
    setAdding(false);
    resetAdd();
  };

  return (
    <div className="px-4 pt-5 pb-28 screen-enter">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-extrabold text-slate-800 dark:text-white tracking-tight">Credit Tracker</h1>
        <button onClick={() => setShowAdd(true)}
          className="w-9 h-9 bg-amber-500 rounded-full flex items-center justify-center shadow-sm active:scale-95 transition-transform">
          <Icon name="plus" size={18} className="text-white" />
        </button>
      </div>

      {/* Hero */}
      <div className="rounded-3xl px-6 py-5 mb-5 text-white relative overflow-hidden shadow-hero"
        style={{ background: "linear-gradient(135deg,#f59e0b 0%,#d97706 55%,#b45309 100%)" }}>
        <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-12 -left-8 w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
        <div className="relative">
          <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-1">Total Outstanding</p>
          <p className="text-3xl font-black tabular mb-4">{fmt(totalOut)}</p>
          <div className="flex gap-5">
            <div>
              <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Debtors</p>
              <p className="text-base font-bold">{credits.length}</p>
            </div>
            {overdue > 0 && (
              <>
                <div className="w-px bg-white/20 self-stretch" />
                <div>
                  <p className="text-[10px] font-semibold text-white/60 uppercase tracking-widest mb-0.5">Overdue</p>
                  <p className="text-base font-bold text-red-200">⚠ {overdue}</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* List */}
      {credits.length === 0 ? (
        <div className="text-center py-14 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700/50">
          <div className="w-16 h-16 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-amber-400" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            </svg>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">No credit records yet</p>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">Tap + to add a debtor</p>
        </div>
      ) : (
        <div className="space-y-3">
          {credits.map(c => {
            const pct = Math.min(100, ((c.amount_paid || 0) / (c.total_amount || 1)) * 100);
            const initials = (c.customer_name || "?")[0].toUpperCase();
            return (
              <div key={c.id} className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-4 shadow-card border border-slate-100 dark:border-slate-700/60">
                <div className="flex items-center gap-3 mb-3">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
                    {c.profile_image_url
                      ? <img src={c.profile_image_url} alt={c.customer_name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-white font-black text-base">{initials}</div>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 dark:text-slate-100 truncate">{c.customer_name}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                      {c.phone && <span>{c.phone} · </span>}Due: {c.due_date || "—"}
                    </p>
                    {staffMap[c.staff_id] && (
                      <span className="inline-block text-[10px] bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full font-semibold mt-1">
                        {staffMap[c.staff_id]}
                      </span>
                    )}
                  </div>
                  <Badge status={c.status} />
                </div>

                <div className="flex gap-2 mb-3">
                  {[
                    { label: "Owed",  value: c.outstanding,  color: "text-red-500 dark:text-red-400" },
                    { label: "Paid",  value: c.amount_paid,  color: "text-green-600 dark:text-green-400" },
                    { label: "Total", value: c.total_amount, color: "text-slate-700 dark:text-slate-200" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex-1 bg-slate-50 dark:bg-slate-700/60 rounded-xl p-2.5">
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mb-0.5">{label}</p>
                      <p className={`text-sm font-extrabold tabular ${color}`}>{fmt(value)}</p>
                    </div>
                  ))}
                </div>

                <div className="mb-2">
                  <div className="flex justify-between text-[10px] font-medium text-slate-400 dark:text-slate-500 mb-1">
                    <span>Paid {Math.round(pct)}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {c.notes && <p className="text-[11px] text-slate-400 dark:text-slate-500 italic mb-3">"{c.notes}"</p>}

                <div className="flex gap-2 pt-2.5 border-t border-slate-50 dark:border-slate-700/60">
                  {c.outstanding > 0 && (
                    <button onClick={() => setRepaying(c)}
                      className="flex-1 py-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded-xl font-bold text-xs border border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30 transition active:scale-[0.99]">
                      Record Payment
                    </button>
                  )}
                  <button onClick={() => setProfile_(c)}
                    className="py-2 px-3 bg-slate-50 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-xs border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition flex items-center gap-1.5 active:scale-[0.99]">
                    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8" />
                    </svg>
                    Profile
                  </button>
                  <button onClick={() => setReceipt(c)}
                    className="py-2 px-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-xl font-bold text-xs border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition flex items-center gap-1.5 active:scale-[0.99]">
                    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M16 13H8" />
                    </svg>
                    Statement
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add Credit Modal ─────────────────────────────────────────── */}
      {showAdd && (
        <Modal title="New Credit Record" onClose={resetAdd}>

          {/* Photo picker */}
          <div className="flex flex-col items-center mb-4 pt-1">
            <div className="relative">
              <div className="w-24 h-24 rounded-2xl overflow-hidden border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 flex items-center justify-center shadow-sm">
                {photoPreview
                  ? <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                  : <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9 text-slate-300 dark:text-slate-500" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8" />
                    </svg>
                }
              </div>
              <label className="absolute -bottom-2 -right-2 w-8 h-8 bg-amber-500 hover:bg-amber-600 rounded-full flex items-center justify-center cursor-pointer shadow-md transition active:scale-95">
                <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 text-white" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" />
                </svg>
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
              </label>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">Tap camera to add photo</p>
          </div>

          <SectionLabel>Credit Details</SectionLabel>
          <Field label="Customer Name *" value={f.customer_name}
            onChange={e => set("customer_name", e.target.value)} placeholder="Full name of debtor" />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Amount Owed (₦) *" type="number" inputMode="decimal" value={f.total_amount}
              onChange={e => set("total_amount", e.target.value)} placeholder="0.00" />
            <Field label="Due Date" type="date" value={f.due_date}
              onChange={e => set("due_date", e.target.value)} />
          </div>

          <SectionLabel>Contact & Identity</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Phone" type="tel" value={f.phone}
              onChange={e => set("phone", e.target.value)} placeholder="08012345678" />
            <Field label="Email" type="email" value={f.email}
              onChange={e => set("email", e.target.value)} placeholder="email@example.com" />
          </div>
          <Field label="NIN" inputMode="numeric" value={f.nin}
            onChange={e => set("nin", e.target.value.replace(/\D/g, "").slice(0, 11))}
            placeholder="11-digit National ID Number" />

          <SectionLabel>Address</SectionLabel>
          <Field label="Street Address" value={f.address}
            onChange={e => set("address", e.target.value)} placeholder="12 Market Road, Onitsha" />
          <Field label="State" as="select" value={f.state}
            onChange={e => { set("state", e.target.value); set("lga", ""); set("ward", ""); }}>
            <option value="">Select State…</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="LGA" as="select" value={f.lga} disabled={!f.state}
              onChange={e => { set("lga", e.target.value); set("ward", ""); }}>
              <option value="">{f.state ? "Select LGA…" : "State first"}</option>
              {lgas.map(l => <option key={l} value={l}>{l}</option>)}
            </Field>
            <Field label="Ward" as="select" value={f.ward} disabled={!f.lga}
              onChange={e => set("ward", e.target.value)}>
              <option value="">{f.lga ? "Select Ward…" : "LGA first"}</option>
              {wards.map(w => <option key={w} value={w}>{w}</option>)}
            </Field>
          </div>

          <SectionLabel>Next of Kin</SectionLabel>
          <Field label="Full Name" value={f.next_of_kin}
            onChange={e => set("next_of_kin", e.target.value)} placeholder="Next of kin name" />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Phone" type="tel" value={f.next_of_kin_phone}
              onChange={e => set("next_of_kin_phone", e.target.value)} placeholder="08012345678" />
            <Field label="Email" type="email" value={f.next_of_kin_email}
              onChange={e => set("next_of_kin_email", e.target.value)} placeholder="email@example.com" />
          </div>
          <Field label="Address" value={f.next_of_kin_address}
            onChange={e => set("next_of_kin_address", e.target.value)} placeholder="Next of kin address" />

          <SectionLabel>Notes</SectionLabel>
          <Field as="textarea" value={f.notes}
            onChange={e => set("notes", e.target.value)} placeholder="Optional notes…" />

          <button onClick={handleAdd}
            disabled={!f.customer_name || !f.total_amount || adding}
            className="w-full py-3.5 mt-1 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] shadow-sm disabled:opacity-50">
            {adding ? "Saving…" : "Save Credit Record"}
          </button>
        </Modal>
      )}

      {/* Repayment modal */}
      {repaying && (
        <Modal title={`Record Payment — ${repaying.customer_name}`}
          onClose={() => { setRepaying(null); setRepayAmt(""); }}>
          <div className="bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-3 mb-4 border border-red-100 dark:border-red-800/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">Outstanding balance</p>
            <p className="text-xl font-black text-red-500 dark:text-red-400 tabular">{fmt(repaying.outstanding)}</p>
          </div>
          <Field label="Payment Amount (₦)" type="number" inputMode="decimal" value={repayAmt}
            onChange={e => setRepayAmt(e.target.value)} placeholder="Enter amount paid" />
          <button
            onClick={() => {
              if (!repayAmt) return;
              repayCredit(repaying.id, parseFloat(repayAmt));
              setRepaying(null); setRepayAmt("");
            }}
            className="w-full py-3.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm transition active:scale-[0.99] shadow-sm">
            Confirm Payment
          </button>
        </Modal>
      )}

      {receipt && (
        <CreditReceipt credit={receipt} profile={profile} onClose={() => setReceipt(null)} />
      )}
      {profile_ && (
        <ClientProfile record={profile_} type="credit" onSave={updateCredit} onClose={() => setProfile_(null)} />
      )}
    </div>
  );
}
