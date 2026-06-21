import { useState, useEffect } from "react";
import { supabase } from "../../utils/supabase";

function Toggle({ on, onToggle, disabled }) {
  return (
    <button onClick={onToggle} disabled={disabled}
      className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 ${on?"bg-[#128c7e]":"bg-slate-200"} ${disabled?"opacity-50":""}`}>
      <div className={`w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${on?"translate-x-[22px]":"translate-x-[2px]"}`}/>
    </button>
  );
}

function Row({ label, sublabel, on, onToggle, disabled }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5 bg-white border-b border-slate-50">
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-[14px] font-semibold text-slate-800">{label}</p>
        {sublabel && <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{sublabel}</p>}
      </div>
      <Toggle on={on} onToggle={onToggle} disabled={disabled}/>
    </div>
  );
}

function SectionHeader({ title }) {
  return <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider px-4 pt-5 pb-2">{title}</p>;
}

function SelectRow({ label, sublabel, value, options, onChange }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5 bg-white border-b border-slate-50">
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-[14px] font-semibold text-slate-800">{label}</p>
        {sublabel && <p className="text-[11px] text-slate-400 mt-0.5">{sublabel}</p>}
      </div>
      <select value={value} onChange={e=>onChange(e.target.value)}
        className="bg-slate-100 text-slate-700 text-[13px] font-bold rounded-xl px-3 py-1.5 outline-none border-none appearance-none pr-6"
        style={{backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2394a3b8'/%3E%3C/svg%3E\")",backgroundRepeat:"no-repeat",backgroundPosition:"right 8px center"}}>
        {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

const DISAPPEARING_OPTS = [
  {value:"off",  label:"Off"},
  {value:"24h",  label:"24 hours"},
  {value:"7d",   label:"7 days"},
  {value:"30d",  label:"30 days"},
  {value:"90d",  label:"90 days"},
];

const SLOW_MODE_OPTS = [
  {value:0,    label:"Off"},
  {value:30,   label:"30 seconds"},
  {value:60,   label:"1 minute"},
  {value:300,  label:"5 minutes"},
  {value:900,  label:"15 minutes"},
  {value:3600, label:"1 hour"},
];

export default function PrivacySettings({ orgId, isAdmin, onBack }) {
  const [settings, setSettings] = useState(null);
  const [saving,   setSaving]   = useState({});
  const [saved,    setSaved]    = useState(null);

  useEffect(()=>{
    supabase.from("org_chat_settings").select("*").eq("org_id",orgId).single()
      .then(({data})=>{ if(data) setSettings(data); });
  },[orgId]);

  const update = async (field, value) => {
    if(!isAdmin) return;
    setSaving(s=>({...s,[field]:true}));
    await supabase.from("org_chat_settings").update({[field]:value}).eq("org_id",orgId);
    setSettings(s=>({...s,[field]:value}));
    setSaving(s=>({...s,[field]:false}));
    setSaved(field);
    setTimeout(()=>setSaved(null),1500);
  };

  if(!settings) return (
    <div className="fixed inset-0 z-[125] flex flex-col bg-[#f0f2f5]">
      <div className="flex-shrink-0 flex items-center gap-2 px-2"
        style={{background:"#075E54",paddingTop:"max(10px,env(safe-area-inset-top))",paddingBottom:"10px"}}>
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-5 h-5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <span className="text-[17px] font-bold text-white">Privacy & Settings</span>
      </div>
      <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#128c7e] border-t-transparent rounded-full animate-spin"/></div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[125] flex flex-col bg-[#f0f2f5]">
      <div className="flex-shrink-0 flex items-center gap-2 px-2"
        style={{background:"#075E54",paddingTop:"max(10px,env(safe-area-inset-top))",paddingBottom:"10px"}}>
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10 flex-shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-5 h-5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <span className="flex-1 text-[17px] font-bold text-white">Privacy & Settings</span>
        {saved && <span className="text-[12px] text-white/80 bg-white/20 px-2 py-0.5 rounded-lg">Saved ✓</span>}
      </div>

      {!isAdmin && (
        <div className="mx-4 mt-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-[13px] text-amber-700 font-medium">Only admins can change these settings.</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-10">
        <SectionHeader title="Chat Controls"/>
        <Row label="Lock Chat"
          sublabel="Only admins can send messages"
          on={settings.chat_locked||false}
          onToggle={()=>update("chat_locked",!settings.chat_locked)}
          disabled={!isAdmin||saving.chat_locked}/>
        <Row label="Anti-Spam"
          sublabel="Automatically filter spam messages"
          on={settings.anti_spam_enabled||false}
          onToggle={()=>update("anti_spam_enabled",!settings.anti_spam_enabled)}
          disabled={!isAdmin||saving.anti_spam_enabled}/>
        <Row label="Restrict Forwarding"
          sublabel="Members cannot forward messages from this group"
          on={settings.forwarding_restricted||false}
          onToggle={()=>update("forwarding_restricted",!settings.forwarding_restricted)}
          disabled={!isAdmin||saving.forwarding_restricted}/>
        <Row label="Restrict Copy"
          sublabel="Disable copy for messages in this group"
          on={settings.copy_restricted||false}
          onToggle={()=>update("copy_restricted",!settings.copy_restricted)}
          disabled={!isAdmin||saving.copy_restricted}/>

        <SectionHeader title="Message Expiry"/>
        <SelectRow label="Disappearing Messages"
          sublabel="New messages auto-delete after this period"
          value={settings.disappearing_messages||"off"}
          options={DISAPPEARING_OPTS}
          onChange={v=>update("disappearing_messages",v)}/>

        <SectionHeader title="Slow Mode"/>
        <SelectRow label="Slow Mode Interval"
          sublabel="Members must wait this long between messages"
          value={settings.slow_mode_seconds||0}
          options={SLOW_MODE_OPTS}
          onChange={v=>update("slow_mode_seconds",parseInt(v))}/>

        <SectionHeader title="Group Visibility"/>
        <Row label="Private Group"
          sublabel="Group won't appear in search results"
          on={settings.is_private||false}
          onToggle={()=>update("is_private",!settings.is_private)}
          disabled={!isAdmin||saving.is_private}/>

        <SectionHeader title="Membership"/>
        {settings.max_members!=null && (
          <div className="px-4 py-3.5 bg-white border-b border-slate-50">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[14px] font-semibold text-slate-800">Max Members</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Current limit for this group</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={()=>update("max_members",Math.max(1,settings.max_members-50))} disabled={!isAdmin}
                  className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 font-bold active:bg-slate-200 disabled:opacity-40">−</button>
                <span className="text-[14px] font-bold text-slate-800 min-w-[40px] text-center">{settings.max_members}</span>
                <button onClick={()=>update("max_members",settings.max_members+50)} disabled={!isAdmin}
                  className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 font-bold active:bg-slate-200 disabled:opacity-40">+</button>
              </div>
            </div>
          </div>
        )}

        <SectionHeader title="Welcome"/>
        <div className="px-4 py-3.5 bg-white border-b border-slate-50">
          <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider mb-1.5">Welcome Message</p>
          <textarea
            value={settings.welcome_message||""}
            onChange={e=>isAdmin&&setSettings(s=>({...s,welcome_message:e.target.value}))}
            onBlur={e=>isAdmin&&update("welcome_message",e.target.value)}
            rows={3}
            placeholder="Sent to new members when they join…"
            disabled={!isAdmin}
            className="w-full bg-slate-100 rounded-xl px-3.5 py-3 text-sm text-slate-800 outline-none resize-none focus:ring-2 focus:ring-[#128c7e] disabled:opacity-60"/>
        </div>
      </div>
    </div>
  );
}
