import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../utils/supabase";

const fmtDate = ts => new Date(ts).toLocaleDateString([],{weekday:"short",day:"numeric",month:"short"});
const fmtTime = ts => new Date(ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
const fmtFull = ts => `${fmtDate(ts)} · ${fmtTime(ts)}`;

const STATUS_COLOR = { going:"#128c7e", maybe:"#f59e0b", not_going:"#ef4444" };
const STATUS_LABEL = { going:"Going", maybe:"Maybe", not_going:"Can't go" };

function EventCard({ event, myId, isAdmin, onDelete }) {
  const [rsvp, setRsvp] = useState(null);
  const [counts, setCounts] = useState({ going:event.rsvp_count||0, maybe:0, not_going:0 });
  const [loadingRsvp, setLoadingRsvp] = useState(false);

  useEffect(()=>{
    if(!myId||!event.id) return;
    supabase.from("group_event_rsvps").select("status").eq("event_id",event.id).eq("user_id",myId)
      .single().then(({data})=>{ if(data) setRsvp(data.status); });
    supabase.from("group_event_rsvps").select("status").eq("event_id",event.id)
      .then(({data})=>{
        if(!data) return;
        const c={going:0,maybe:0,not_going:0};
        data.forEach(r=>{ c[r.status]=(c[r.status]||0)+1; });
        setCounts(c);
      });
  },[event.id,myId]);

  const castRsvp = async status => {
    if(loadingRsvp) return;
    setLoadingRsvp(true);
    const prev = rsvp;
    if(status===rsvp){
      await supabase.from("group_event_rsvps").delete().match({event_id:event.id,user_id:myId});
      setRsvp(null);
      setCounts(c=>({...c,[status]:Math.max(0,c[status]-1)}));
    } else {
      await supabase.from("group_event_rsvps").upsert({event_id:event.id,org_id:event.org_id,user_id:myId,status},{onConflict:"event_id,user_id"});
      setRsvp(status);
      setCounts(c=>{
        const n={...c,[status]:(c[status]||0)+1};
        if(prev) n[prev]=Math.max(0,n[prev]-1);
        return n;
      });
    }
    setLoadingRsvp(false);
  };

  const isPast = event.start_time && new Date(event.start_time)<new Date();

  return (
    <div className="bg-white mx-4 my-3 rounded-2xl shadow-sm overflow-hidden">
      {event.cover_image_url && (
        <img src={event.cover_image_url} alt="" className="w-full h-36 object-cover"/>
      )}
      <div className={`px-4 py-3.5 ${!event.cover_image_url?"":"border-t border-slate-50"}`}>
        <div className="flex items-start gap-2">
          <div className="flex-shrink-0 flex flex-col items-center bg-[#075E54] rounded-xl px-2.5 py-1.5 text-white min-w-[42px]">
            <span className="text-[9px] font-bold uppercase opacity-80">{new Date(event.start_time).toLocaleString([],{month:"short"})}</span>
            <span className="text-[20px] font-extrabold leading-none">{new Date(event.start_time).getDate()}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-slate-900 leading-snug">{event.title}</p>
            <p className="text-[12px] text-slate-400 mt-0.5">{fmtFull(event.start_time)}{event.end_time?` – ${fmtTime(event.end_time)}`:""}</p>
            {event.location && (
              <div className="flex items-center gap-1 mt-0.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2} className="w-3 h-3 flex-shrink-0"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span className="text-[11px] text-slate-400 truncate">{event.location}</span>
              </div>
            )}
          </div>
          {isAdmin && !isPast && (
            <button onClick={()=>onDelete(event.id)} className="w-7 h-7 flex items-center justify-center text-slate-300 active:text-red-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
            </button>
          )}
        </div>

        {event.description && (
          <p className="text-[13px] text-slate-600 mt-2.5 leading-relaxed">{event.description}</p>
        )}

        {!isPast && (
          <div className="flex gap-2 mt-3">
            {["going","maybe","not_going"].map(s=>(
              <button key={s} onClick={()=>castRsvp(s)} disabled={loadingRsvp}
                className={`flex-1 py-2 rounded-xl text-[11px] font-bold border-2 transition-all active:scale-[0.97]
                  ${rsvp===s?"text-white border-transparent":"bg-transparent border-slate-100 text-slate-400"}`}
                style={rsvp===s?{background:STATUS_COLOR[s],borderColor:STATUS_COLOR[s]}:{}}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 mt-2.5">
          {Object.entries(counts).map(([s,n])=>n>0&&(
            <span key={s} className="text-[11px] font-bold" style={{color:STATUS_COLOR[s]}}>{n} {STATUS_LABEL[s]}</span>
          ))}
          {isPast && <span className="text-[11px] text-slate-400">Event ended</span>}
        </div>
      </div>
    </div>
  );
}

function CreateEventSheet({ orgId, myId, myName, myRole, onCreated, onClose }) {
  const [title,    setTitle]    = useState("");
  const [desc,     setDesc]     = useState("");
  const [location, setLocation] = useState("");
  const [start,    setStart]    = useState("");
  const [end,      setEnd]      = useState("");
  const [saving,   setSaving]   = useState(false);

  const submit = async () => {
    if(!title.trim()||!start) return;
    setSaving(true);
    const {data:event} = await supabase.from("group_events").insert({
      org_id:orgId, created_by:myId,
      title:title.trim(), description:desc.trim()||null,
      location:location.trim()||null,
      start_time:start, end_time:end||null,
    }).select().single();
    if(event) {
      await supabase.from("org_group_messages").insert({
        org_id:orgId, sender_id:myId,
        sender_name:myName||"Admin", sender_role:myRole||"admin",
        type:"event", media_name:event.id, content:title.trim(),
      });
    }
    onCreated();
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"/>
      <div className="relative w-full max-w-md bg-white rounded-t-3xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e=>e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 flex-shrink-0"/>
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-extrabold text-slate-800">Create Event</h3>
          <button onClick={onClose} className="text-slate-400"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {[
            {label:"Title *",          val:title,    set:setTitle,    placeholder:"Event title…"},
            {label:"Location",         val:location, set:setLocation, placeholder:"Where is it? (optional)"},
          ].map(f=>(
            <div key={f.label}>
              <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">{f.label}</label>
              <input value={f.val} onChange={e=>f.set(e.target.value)} placeholder={f.placeholder}
                className="w-full bg-slate-100 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-[#128c7e]"/>
            </div>
          ))}
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Description</label>
            <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={3} placeholder="What's this event about? (optional)"
              className="w-full bg-slate-100 rounded-xl px-3.5 py-3 text-sm text-slate-800 outline-none resize-none focus:ring-2 focus:ring-[#128c7e]"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Starts *</label>
              <input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}
                className="w-full bg-slate-100 rounded-xl px-3 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-[#128c7e]"/>
            </div>
            <div>
              <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Ends</label>
              <input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}
                className="w-full bg-slate-100 rounded-xl px-3 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-[#128c7e]"/>
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex gap-2 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold text-sm">Cancel</button>
          <button onClick={submit} disabled={saving||!title.trim()||!start}
            className="flex-1 py-3 bg-[#128c7e] text-white rounded-xl font-bold text-sm disabled:opacity-50 active:opacity-80">
            {saving?"Creating…":"Create Event"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GroupEvents({ orgId, myId, myName, myRole, isAdmin, onBack }) {
  const [events,     setEvents]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filter,     setFilter]     = useState("upcoming");

  const load = useCallback(async()=>{
    setLoading(true);
    const now = new Date().toISOString();
    let q = supabase.from("group_events").select("*").eq("org_id",orgId).order("start_time",{ascending:true});
    if(filter==="upcoming") q=q.gte("start_time",now);
    if(filter==="past")     q=q.lt("start_time",now).order("start_time",{ascending:false});
    const {data}=await q;
    setEvents(data||[]);
    setLoading(false);
  },[orgId,filter]);

  useEffect(()=>{ load(); },[load]);

  const handleDelete = async id => {
    await supabase.from("group_events").delete().eq("id",id);
    setEvents(es=>es.filter(e=>e.id!==id));
  };

  return (
    <div className="fixed inset-0 z-[125] flex flex-col bg-[#f0f2f5]">
      <div className="flex-shrink-0 flex items-center gap-2 px-2"
        style={{background:"#075E54",paddingTop:"max(10px,env(safe-area-inset-top))",paddingBottom:"10px"}}>
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10 flex-shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-5 h-5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <span className="flex-1 text-[17px] font-bold text-white">Events</span>
        {isAdmin && (
          <button onClick={()=>setShowCreate(true)} className="text-[13px] font-bold text-white bg-white/20 px-3 py-1.5 rounded-xl active:bg-white/30">+ Event</button>
        )}
      </div>

      <div className="flex-shrink-0 bg-white border-b border-slate-100 flex">
        {["upcoming","past"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)}
            className={`flex-1 py-2.5 text-[12px] font-bold border-b-2 transition-colors ${filter===f?"border-[#128c7e] text-[#128c7e]":"border-transparent text-slate-400"}`}>
            {f.charAt(0).toUpperCase()+f.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading
          ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#128c7e] border-t-transparent rounded-full animate-spin"/></div>
          : events.length===0
          ? <div className="flex flex-col items-center py-16 text-slate-400 gap-2">
              <span className="text-5xl">📅</span>
              <p className="text-sm">{filter==="upcoming"?"No upcoming events":"No past events"}</p>
              {isAdmin&&filter==="upcoming"&&<button onClick={()=>setShowCreate(true)} className="mt-2 px-4 py-2 bg-[#128c7e] text-white text-sm font-bold rounded-xl active:opacity-80">Create first event</button>}
            </div>
          : events.map(e=><EventCard key={e.id} event={e} myId={myId} isAdmin={isAdmin} onDelete={handleDelete}/>)}
        <div className="h-6"/>
      </div>

      {showCreate && <CreateEventSheet orgId={orgId} myId={myId} myName={myName} myRole={myRole} onCreated={load} onClose={()=>setShowCreate(false)}/>}
    </div>
  );
}
