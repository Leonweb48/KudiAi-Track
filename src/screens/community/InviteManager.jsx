import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../utils/supabase";

const BASE_URL = window.location.origin;

function QRCode({ text, size=160 }) {
  const [src, setSrc] = useState("");
  useEffect(()=>{
    const encoded = encodeURIComponent(text);
    setSrc(`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}`);
  },[text,size]);
  return src
    ? <img src={src} alt="QR code" className="rounded-xl border border-slate-100" style={{width:size,height:size}}/>
    : <div className="rounded-xl bg-slate-100 flex items-center justify-center" style={{width:size,height:size}}><div className="w-6 h-6 border-2 border-slate-300 border-t-transparent rounded-full animate-spin"/></div>;
}

function InviteCard({ invite, orgId, onDeactivated }) {
  const [copied,       setCopied]       = useState(false);
  const [showQR,       setShowQR]       = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const link = `${BASE_URL}/join/${invite.code}`;

  const copy = async () => {
    await navigator.clipboard.writeText(link).catch(()=>{});
    setCopied(true);
    setTimeout(()=>setCopied(false),2000);
  };

  const deactivate = async () => {
    setDeactivating(true);
    await supabase.from("group_invites").update({is_active:false}).eq("id",invite.id);
    onDeactivated(invite.id);
    setDeactivating(false);
  };

  const isExpired = invite.expires_at && new Date(invite.expires_at)<new Date();
  const isExhausted = invite.max_uses && invite.use_count>=invite.max_uses;
  const inactive = !invite.is_active||isExpired||isExhausted;

  return (
    <div className={`bg-white mx-4 my-3 rounded-2xl shadow-sm overflow-hidden ${inactive?"opacity-60":""}`}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[16px] font-mono font-extrabold text-[#075E54] tracking-widest">{invite.code}</span>
              {!inactive
                ? <span className="text-[10px] font-bold text-[#128c7e] bg-[#128c7e]/10 px-1.5 py-0.5 rounded-full">Active</span>
                : isExpired
                ? <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">Expired</span>
                : isExhausted
                ? <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">Uses exhausted</span>
                : <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">Deactivated</span>}
            </div>
            {invite.label && <p className="text-[12px] text-slate-500 mt-0.5">{invite.label}</p>}
          </div>
          {invite.is_active && !isExpired && !isExhausted && (
            <button onClick={deactivate} disabled={deactivating}
              className="text-[11px] font-bold text-red-500 bg-red-50 px-2.5 py-1 rounded-xl active:bg-red-100 flex-shrink-0 disabled:opacity-50">
              {deactivating?"…":"Disable"}
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-3 text-[11px] text-slate-400 mb-3">
          <span>Uses: <b className="text-slate-600">{invite.use_count||0}{invite.max_uses?`/${invite.max_uses}`:""}</b></span>
          {invite.expires_at && <span>Expires: <b className="text-slate-600">{new Date(invite.expires_at).toLocaleDateString([],{day:"numeric",month:"short"})}</b></span>}
          {invite.requires_approval && <span className="text-amber-600 font-bold">Needs approval</span>}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 bg-slate-100 rounded-xl px-3 py-2 flex items-center gap-2 min-w-0">
            <span className="text-[12px] text-slate-500 truncate">{link}</span>
          </div>
          <button onClick={copy} className="w-10 h-10 rounded-xl bg-[#128c7e]/10 flex items-center justify-center flex-shrink-0 active:bg-[#128c7e]/20">
            {copied
              ? <svg viewBox="0 0 24 24" fill="none" stroke="#128c7e" strokeWidth={2.5} className="w-4 h-4"><path d="M20 6L9 17l-5-5"/></svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="#128c7e" strokeWidth={2} className="w-4 h-4"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>}
          </button>
          <button onClick={()=>setShowQR(q=>!q)} className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0 active:bg-slate-200">
            <span className="text-base">▦</span>
          </button>
        </div>

        {showQR && (
          <div className="mt-3 flex justify-center">
            <QRCode text={link}/>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateInviteSheet({ orgId, myId, onCreated, onClose }) {
  const [label,    setLabel]    = useState("");
  const [maxUses,  setMaxUses]  = useState("");
  const [expires,  setExpires]  = useState("");
  const [approval, setApproval] = useState(false);
  const [saving,   setSaving]   = useState(false);

  const submit = async () => {
    setSaving(true);
    await supabase.from("group_invites").insert({
      org_id:orgId, created_by:myId,
      label:label.trim()||null,
      max_uses:maxUses?parseInt(maxUses):null,
      expires_at:expires||null,
      requires_approval:approval,
      is_active:true,
    });
    onCreated();
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"/>
      <div className="relative w-full max-w-md bg-white rounded-t-3xl overflow-hidden flex flex-col max-h-[80vh]"
        onClick={e=>e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 flex-shrink-0"/>
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-extrabold text-slate-800">New Invite Link</h3>
          <button onClick={onClose} className="text-slate-400"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Label (optional)</label>
            <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="e.g. New members Jan"
              className="w-full bg-slate-100 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-[#128c7e]"/>
          </div>
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Max uses (optional)</label>
            <input type="number" min="1" value={maxUses} onChange={e=>setMaxUses(e.target.value)} placeholder="Unlimited"
              className="w-full bg-slate-100 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-[#128c7e]"/>
          </div>
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Expiry (optional)</label>
            <input type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)}
              className="w-full bg-slate-100 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-[#128c7e]"/>
          </div>
          <label className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Require admin approval</span>
            <button onClick={()=>setApproval(a=>!a)}
              className={`w-11 h-6 rounded-full transition-colors ${approval?"bg-[#128c7e]":"bg-slate-200"}`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${approval?"translate-x-[22px]":"translate-x-[2px]"}`}/>
            </button>
          </label>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex gap-2 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold text-sm">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-3 bg-[#128c7e] text-white rounded-xl font-bold text-sm disabled:opacity-50 active:opacity-80">
            {saving?"Creating…":"Create Link"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function InviteManager({ orgId, myId, isAdmin, onBack }) {
  const [invites,    setInvites]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filter,     setFilter]     = useState("active");

  const load = useCallback(async()=>{
    setLoading(true);
    const {data}=await supabase.from("group_invites").select("*").eq("org_id",orgId).order("created_at",{ascending:false});
    setInvites(data||[]);
    setLoading(false);
  },[orgId]);

  useEffect(()=>{ load(); },[load]);

  const handleDeactivated = id => setInvites(is=>is.map(i=>i.id===id?{...i,is_active:false}:i));

  const filtered = invites.filter(i=>{
    const active=i.is_active&&!(i.expires_at&&new Date(i.expires_at)<new Date())&&!(i.max_uses&&i.use_count>=i.max_uses);
    return filter==="active"?active:!active;
  });

  return (
    <div className="fixed inset-0 z-[125] flex flex-col bg-[#f0f2f5]">
      <div className="flex-shrink-0 flex items-center gap-2 px-2"
        style={{background:"#075E54",paddingTop:"max(10px,env(safe-area-inset-top))",paddingBottom:"10px"}}>
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10 flex-shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-5 h-5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <span className="flex-1 text-[17px] font-bold text-white">Invite Links</span>
        {isAdmin && (
          <button onClick={()=>setShowCreate(true)} className="text-[13px] font-bold text-white bg-white/20 px-3 py-1.5 rounded-xl active:bg-white/30">+ Link</button>
        )}
      </div>

      <div className="flex-shrink-0 bg-white border-b border-slate-100 flex">
        {["active","inactive"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)}
            className={`flex-1 py-2.5 text-[12px] font-bold border-b-2 transition-colors ${filter===f?"border-[#128c7e] text-[#128c7e]":"border-transparent text-slate-400"}`}>
            {f.charAt(0).toUpperCase()+f.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading
          ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#128c7e] border-t-transparent rounded-full animate-spin"/></div>
          : filtered.length===0
          ? <div className="flex flex-col items-center py-16 text-slate-400 gap-2">
              <span className="text-5xl">🔗</span>
              <p className="text-sm">{filter==="active"?"No active invite links":"No inactive links"}</p>
              {isAdmin&&filter==="active"&&<button onClick={()=>setShowCreate(true)} className="mt-2 px-4 py-2 bg-[#128c7e] text-white text-sm font-bold rounded-xl active:opacity-80">Create first link</button>}
            </div>
          : filtered.map(i=><InviteCard key={i.id} invite={i} orgId={orgId} onDeactivated={handleDeactivated}/>)}
        <div className="h-6"/>
      </div>

      {showCreate && <CreateInviteSheet orgId={orgId} myId={myId} onCreated={load} onClose={()=>setShowCreate(false)}/>}
    </div>
  );
}
