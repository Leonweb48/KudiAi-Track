import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../utils/supabase";

const fmtDate = ts => new Date(ts).toLocaleDateString([],{day:"numeric",month:"short",year:"numeric"});

function PollCard({ poll, myId, onVote, onClose, isAdmin }) {
  const [voted, setVoted] = useState(false);
  const [myVotes, setMyVotes] = useState(new Set());
  const [localOpts, setLocalOpts] = useState(poll.options||[]);
  const [localTotal, setLocalTotal] = useState(poll.total_votes||0);

  useEffect(()=>{
    if(!myId||!poll.id)return;
    supabase.from("group_poll_votes").select("option_id").eq("poll_id",poll.id).eq("user_id",myId)
      .then(({data})=>{if(data?.length){setVoted(true);setMyVotes(new Set(data.map(v=>v.option_id)));}});
  },[poll.id,myId]);

  const castVote = async optId => {
    if(voted&&!poll.allows_multiple) return;
    const alreadyVoted = myVotes.has(optId);
    if(alreadyVoted){
      await supabase.from("group_poll_votes").delete().match({poll_id:poll.id,option_id:optId,user_id:myId});
      setMyVotes(p=>{const n=new Set(p);n.delete(optId);return n;});
      setLocalOpts(os=>os.map(o=>o.id===optId?{...o,vote_count:Math.max(0,o.vote_count-1)}:o));
      setLocalTotal(t=>Math.max(0,t-1));
      if(!poll.allows_multiple) setVoted(false);
    } else {
      await supabase.from("group_poll_votes").insert({poll_id:poll.id,option_id:optId,org_id:poll.org_id,user_id:myId});
      setMyVotes(p=>new Set([...p,optId]));
      setLocalOpts(os=>os.map(o=>o.id===optId?{...o,vote_count:o.vote_count+1}:o));
      setLocalTotal(t=>t+1);
      setVoted(true);
    }
  };

  const closePoll = async () => {
    await supabase.from("group_polls").update({is_closed:true}).eq("id",poll.id);
    onClose(poll.id);
  };

  const isExpired = poll.expires_at && new Date(poll.expires_at)<new Date();
  const showResults = voted||poll.is_closed||isExpired;

  return (
    <div className="bg-white mx-4 my-3 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-slate-50">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-slate-900 leading-snug">{poll.question}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-[11px] text-slate-400">{localTotal} vote{localTotal!==1?"s":""}</span>
              {poll.allows_multiple && <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full">Multiple choice</span>}
              {poll.is_anonymous && <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">Anonymous</span>}
              {(poll.is_closed||isExpired) && <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">Closed</span>}
              {poll.expires_at && !isExpired && !poll.is_closed && (
                <span className="text-[10px] text-slate-400">· ends {fmtDate(poll.expires_at)}</span>
              )}
            </div>
          </div>
          {isAdmin && !poll.is_closed && (
            <button onClick={closePoll} className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-1 rounded-xl active:bg-red-100 flex-shrink-0">Close</button>
          )}
        </div>
      </div>

      <div className="px-4 py-3 flex flex-col gap-2">
        {localOpts.map(opt => {
          const pct = localTotal>0 ? Math.round((opt.vote_count/localTotal)*100) : 0;
          const isMine = myVotes.has(opt.id);
          return (
            <button key={opt.id} onClick={()=>(!poll.is_closed&&!isExpired)?castVote(opt.id):null}
              className={`relative w-full rounded-xl overflow-hidden border-2 transition-all text-left
                ${isMine?"border-[#128c7e]":"border-slate-100"}
                ${poll.is_closed||isExpired?"cursor-default":"active:scale-[0.98]"}`}>
              {showResults && (
                <div className="absolute inset-0 rounded-[10px] transition-all"
                  style={{width:`${pct}%`,background:isMine?"#dcf8c6":"#f0f2f5"}}/>
              )}
              <div className="relative flex items-center justify-between px-3 py-2.5 gap-2">
                <span className="text-[13px] font-medium text-slate-800 flex-1">{opt.text}</span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isMine && <span className="text-[#128c7e]">✓</span>}
                  {showResults && <span className="text-[12px] font-bold text-slate-600">{pct}%</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CreatePollSheet({ orgId, myId, myName, myRole, onCreated, onClose }) {
  const [question, setQuestion]   = useState("");
  const [options,  setOptions]    = useState(["","","",""]);
  const [multi,    setMulti]      = useState(false);
  const [anon,     setAnon]       = useState(false);
  const [expires,  setExpires]    = useState("");
  const [saving,   setSaving]     = useState(false);

  const addOption    = () => setOptions(o=>[...o,""]);
  const removeOption = i => setOptions(o=>o.filter((_,idx)=>idx!==i));
  const setOpt       = (i,v) => setOptions(o=>o.map((x,idx)=>idx===i?v:x));

  const submit = async () => {
    const validOpts = options.filter(o=>o.trim());
    if(!question.trim()||validOpts.length<2) return;
    setSaving(true);
    const {data:poll} = await supabase.from("group_polls").insert({
      org_id:orgId, created_by:myId, question:question.trim(),
      allows_multiple:multi, is_anonymous:anon,
      expires_at:expires||null,
    }).select().single();

    if(poll) {
      await supabase.from("group_poll_options").insert(
        validOpts.map((t,i)=>({poll_id:poll.id,org_id:orgId,text:t.trim(),sort_order:i}))
      );
      await supabase.from("org_group_messages").insert({
        org_id:orgId, sender_id:myId,
        sender_name:myName||"Admin", sender_role:myRole||"admin",
        type:"poll", media_name:poll.id, content:question.trim(),
      });
      onCreated();
    }
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"/>
      <div className="relative w-full max-w-md bg-white rounded-t-3xl overflow-hidden flex flex-col max-h-[90dvh]"
        onClick={e=>e.stopPropagation()}>
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 flex-shrink-0"/>
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-extrabold text-slate-800">Create Poll</h3>
          <button onClick={onClose} className="text-slate-400"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Question *</label>
            <textarea value={question} onChange={e=>setQuestion(e.target.value)} rows={2}
              placeholder="Ask a question…"
              className="w-full bg-slate-100 rounded-xl px-3.5 py-3 text-sm text-slate-800 outline-none resize-none focus:ring-2 focus:ring-[#128c7e]"/>
          </div>
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Options * (min 2)</label>
            <div className="flex flex-col gap-2">
              {options.map((o,i)=>(
                <div key={i} className="flex items-center gap-2">
                  <input value={o} onChange={e=>setOpt(i,e.target.value)} placeholder={`Option ${i+1}`}
                    className="flex-1 bg-slate-100 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-[#128c7e]"/>
                  {options.length>2 && (
                    <button onClick={()=>removeOption(i)} className="w-7 h-7 flex items-center justify-center text-red-400 active:scale-90">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            {options.length<10 && (
              <button onClick={addOption} className="mt-2 text-sm font-bold text-[#128c7e] active:opacity-70">+ Add option</button>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <label className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Allow multiple votes</span>
              <button onClick={()=>setMulti(m=>!m)}
                className={`w-11 h-6 rounded-full transition-colors ${multi?"bg-[#128c7e]":"bg-slate-200"}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${multi?"translate-x-5.5":"translate-x-0.5"}`}/>
              </button>
            </label>
            <label className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Anonymous poll</span>
              <button onClick={()=>setAnon(a=>!a)}
                className={`w-11 h-6 rounded-full transition-colors ${anon?"bg-[#128c7e]":"bg-slate-200"}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${anon?"translate-x-5.5":"translate-x-0.5"}`}/>
              </button>
            </label>
          </div>
          <div>
            <label className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block mb-1.5">Expires (optional)</label>
            <input type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)}
              className="w-full bg-slate-100 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-[#128c7e]"/>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex gap-2 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold text-sm">Cancel</button>
          <button onClick={submit} disabled={saving||!question.trim()||options.filter(o=>o.trim()).length<2}
            className="flex-1 py-3 bg-[#128c7e] text-white rounded-xl font-bold text-sm disabled:opacity-50 active:opacity-80">
            {saving?"Creating…":"Create Poll"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GroupPolls({ orgId, myId, myName, myRole, isAdmin, onBack }) {
  const [polls,      setPolls]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filter,     setFilter]     = useState("active"); // active | closed | all

  const load = useCallback(async()=>{
    setLoading(true);
    let q = supabase.from("group_polls").select("*, options:group_poll_options(*)").eq("org_id",orgId).order("created_at",{ascending:false});
    if(filter==="active") q=q.eq("is_closed",false);
    if(filter==="closed") q=q.eq("is_closed",true);
    const {data}=await q;
    setPolls(data||[]);
    setLoading(false);
  },[orgId,filter]);

  useEffect(()=>{ load(); },[load]);

  const handleClose = id => setPolls(ps=>ps.map(p=>p.id===id?{...p,is_closed:true}:p));

  return(
    <div className="fixed inset-0 z-[125] flex flex-col bg-[#f0f2f5]">
      <div className="flex-shrink-0 flex items-center gap-2 px-2"
        style={{background:"#075E54",paddingTop:"max(10px,env(safe-area-inset-top))",paddingBottom:"10px"}}>
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10 flex-shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-5 h-5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <span className="flex-1 text-[17px] font-bold text-white">Polls</span>
        {isAdmin && (
          <button onClick={()=>setShowCreate(true)} className="text-[13px] font-bold text-white bg-white/20 px-3 py-1.5 rounded-xl active:bg-white/30">+ Poll</button>
        )}
      </div>

      {/* Filter */}
      <div className="flex-shrink-0 bg-white border-b border-slate-100 flex">
        {["active","closed","all"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)}
            className={`flex-1 py-2.5 text-[12px] font-bold border-b-2 transition-colors ${filter===f?"border-[#128c7e] text-[#128c7e]":"border-transparent text-slate-400"}`}>
            {f.charAt(0).toUpperCase()+f.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading
          ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#128c7e] border-t-transparent rounded-full animate-spin"/></div>
          : polls.length===0
          ? <div className="flex flex-col items-center py-16 text-slate-400 gap-2">
              <span className="text-5xl">📊</span>
              <p className="text-sm">{filter==="active"?"No active polls":"No polls yet"}</p>
              {isAdmin&&filter==="active"&&<button onClick={()=>setShowCreate(true)} className="mt-2 px-4 py-2 bg-[#128c7e] text-white text-sm font-bold rounded-xl active:opacity-80">Create first poll</button>}
            </div>
          : polls.map(p=>(
              <PollCard key={p.id} poll={p} myId={myId} isAdmin={isAdmin} onVote={load} onClose={handleClose}/>
            ))}
        <div className="h-6"/>
      </div>

      {showCreate && (
        <CreatePollSheet orgId={orgId} myId={myId} myName={myName} myRole={myRole} onCreated={load} onClose={()=>setShowCreate(false)}/>
      )}
    </div>
  );
}
