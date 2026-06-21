import { useState, useCallback, useRef } from "react";
import { supabase } from "../../utils/supabase";

const fmtDate = ts => new Date(ts).toLocaleDateString([],{day:"numeric",month:"short",year:"numeric"});

const TABS = [
  { id:"messages", label:"Messages", icon:"💬" },
  { id:"media",    label:"Media",    icon:"🖼️" },
  { id:"members",  label:"Members",  icon:"👥" },
];

function Highlight({ text, query }) {
  if(!query||!text) return <span>{text}</span>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")})`, "gi"));
  return (
    <span>
      {parts.map((p,i)=>
        p.toLowerCase()===query.toLowerCase()
          ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded-sm px-0.5">{p}</mark>
          : <span key={i}>{p}</span>
      )}
    </span>
  );
}

function MessageResult({ item, query, onJump }) {
  return (
    <button onClick={()=>onJump&&onJump(item.id)}
      className="w-full text-left px-4 py-3.5 border-b border-slate-50 bg-white active:bg-slate-50 flex items-start gap-3">
      <div className="w-9 h-9 rounded-full bg-[#128c7e] flex items-center justify-center text-white text-sm font-bold flex-shrink-0 overflow-hidden">
        {item.avatar_url
          ? <img src={item.avatar_url} alt="" className="w-full h-full object-cover"/>
          : (item.sender_name||"?")[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-[13px] font-bold text-slate-800 truncate">{item.sender_name}</p>
          <span className="text-[10px] text-slate-400 flex-shrink-0">{fmtDate(item.created_at)}</span>
        </div>
        <p className="text-[13px] text-slate-600 leading-relaxed line-clamp-2">
          <Highlight text={item.content} query={query}/>
        </p>
      </div>
    </button>
  );
}

function MediaResult({ item, query }) {
  const ext = item.file_name?.split(".").pop()?.toUpperCase()||"";
  const isImg = ["jpg","jpeg","png","gif","webp","avif"].includes(ext.toLowerCase());
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-50 bg-white active:bg-slate-50">
      <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {isImg
          ? <img src={item.url} alt="" className="w-full h-full object-cover"/>
          : <span className="text-xl">📄</span>}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-slate-800 truncate">
          <Highlight text={item.file_name||"File"} query={query}/>
        </p>
        <p className="text-[11px] text-slate-400">{item.sender_name} · {fmtDate(item.created_at)}</p>
      </div>
    </a>
  );
}

function MemberResult({ item, query }) {
  const ROLE_COLOR = {
    owner:{bg:"#fef3c7",text:"#92400e"},
    admin:{bg:"#ede9fe",text:"#6d28d9"},
    moderator:{bg:"#dbeafe",text:"#1d4ed8"},
    verified:{bg:"#d1fae5",text:"#065f46"},
    premium:{bg:"#fce7f3",text:"#9d174d"},
    member:{bg:"#f1f5f9",text:"#475569"},
  };
  const rs=ROLE_COLOR[item.chat_role||"member"]||ROLE_COLOR.member;
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-50 bg-white">
      <div className="w-11 h-11 rounded-full bg-[#128c7e] flex items-center justify-center text-white text-base font-bold flex-shrink-0 overflow-hidden">
        {item.avatar_url
          ? <img src={item.avatar_url} alt="" className="w-full h-full object-cover"/>
          : (item.display_name||"?")[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-slate-800 truncate">
          <Highlight text={item.display_name} query={query}/>
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{background:rs.bg,color:rs.text}}>
            {(item.chat_role||"member").charAt(0).toUpperCase()+(item.chat_role||"member").slice(1)}
          </span>
          <span className="text-[11px] text-slate-400">Level {item.level||1}</span>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-[12px] font-bold text-[#128c7e]">{item.reputation_points||0}</p>
        <p className="text-[10px] text-slate-400">pts</p>
      </div>
    </div>
  );
}

export default function GroupSearch({ orgId, onBack }) {
  const [tab,      setTab]      = useState("messages");
  const [query,    setQuery]    = useState("");
  const [results,  setResults]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef(null);

  const search = useCallback(async (q, t) => {
    if(!q.trim()){ setResults([]); setSearched(false); return; }
    setLoading(true);
    setSearched(true);

    if(t==="messages"){
      const {data}=await supabase.rpc("search_group_messages",{p_org_id:orgId,p_query:q,p_limit:50,p_offset:0});
      setResults(data||[]);
    } else if(t==="media"){
      const {data}=await supabase.rpc("search_group_media",{p_org_id:orgId,p_query:q,p_limit:50,p_offset:0,p_media_type:null});
      setResults(data||[]);
    } else if(t==="members"){
      const {data}=await supabase.from("org_members")
        .select("user_id,display_name,avatar_url,chat_role,level,reputation_points")
        .eq("org_id",orgId).ilike("display_name",`%${q}%`).limit(50);
      setResults(data||[]);
    }

    setLoading(false);
  },[orgId]);

  const handleInput = q => {
    setQuery(q);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(()=>search(q,tab),400);
  };

  const handleTabChange = t => {
    setTab(t);
    if(query.trim()) search(query,t);
  };

  return (
    <div className="fixed inset-0 z-[125] flex flex-col bg-[#f0f2f5]">
      <div className="flex-shrink-0 flex items-center gap-2 px-2"
        style={{background:"#075E54",paddingTop:"max(10px,env(safe-area-inset-top))",paddingBottom:"10px"}}>
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10 flex-shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-5 h-5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <div className="flex-1 flex items-center gap-2 bg-white/20 rounded-xl px-3 py-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 flex-shrink-0"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input value={query} onChange={e=>handleInput(e.target.value)} placeholder="Search…" autoFocus
            className="flex-1 bg-transparent text-sm text-white placeholder-white/70 outline-none"/>
          {query && (
            <button onClick={()=>{setQuery("");setResults([]);setSearched(false);}} className="text-white/70">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 bg-white border-b border-slate-100 flex">
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>handleTabChange(t.id)}
            className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-[12px] font-bold border-b-2 transition-colors
              ${tab===t.id?"border-[#128c7e] text-[#128c7e]":"border-transparent text-slate-400"}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading
          ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#128c7e] border-t-transparent rounded-full animate-spin"/></div>
          : !searched
          ? <div className="flex flex-col items-center py-16 text-slate-400 gap-2">
              <span className="text-5xl">🔍</span>
              <p className="text-sm">Search {tab} in this group</p>
            </div>
          : results.length===0
          ? <div className="flex flex-col items-center py-16 text-slate-400 gap-2">
              <span className="text-5xl">😕</span>
              <p className="text-sm">No {tab} found for "{query}"</p>
            </div>
          : tab==="messages"
          ? results.map(r=><MessageResult key={r.id} item={r} query={query}/>)
          : tab==="media"
          ? results.map(r=><MediaResult key={r.id} item={r} query={query}/>)
          : results.map(r=><MemberResult key={r.user_id} item={r} query={query}/>)}
        <div className="h-6"/>
      </div>
    </div>
  );
}
