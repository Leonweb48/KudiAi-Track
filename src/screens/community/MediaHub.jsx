import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../utils/supabase";

const TABS = [
  { id:"photo",    label:"Photos",    icon:"🖼️" },
  { id:"video",    label:"Videos",    icon:"🎬" },
  { id:"audio",    label:"Audio",     icon:"🎵" },
  { id:"document", label:"Docs",      icon:"📄" },
  { id:"link",     label:"Links",     icon:"🔗" },
];

const PAGE = 30;

function PhotoGrid({ items, onTap }) {
  return (
    <div className="grid grid-cols-3 gap-0.5">
      {items.map(m => (
        <button key={m.id} onClick={()=>onTap(m)}
          className="relative aspect-square bg-slate-200 overflow-hidden active:opacity-80">
          {m.thumbnail_url
            ? <img src={m.thumbnail_url} alt="" className="w-full h-full object-cover"/>
            : <img src={m.url} alt="" className="w-full h-full object-cover" loading="lazy"/>}
          {m.media_type==="video" && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-10 h-10 bg-black/50 rounded-full flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5"><path d="M8 5v14l11-7z"/></svg>
              </div>
            </div>
          )}
          <div className="absolute bottom-1 right-1 text-[9px] text-white bg-black/50 px-1 rounded">
            {new Date(m.created_at).toLocaleDateString([],{day:"numeric",month:"short"})}
          </div>
        </button>
      ))}
    </div>
  );
}

function AudioItem({ item }) {
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(item.duration || 0);
  const audioRef = useRef(null);

  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else {
      if (a.readyState < 2) a.load();
      try { await a.play(); setPlaying(true); } catch { setPlaying(false); }
    }
  };

  const fmtD = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-50 bg-white">
      <audio ref={audioRef} src={item.url} preload="none" playsInline style={{display:"none"}}
        onEnded={()=>{setPlaying(false);setCur(0);}}
        onTimeUpdate={e=>setCur(e.target.currentTime)}
        onLoadedMetadata={e=>{if(isFinite(e.target.duration))setDur(e.target.duration);}}/>
      <button onClick={toggle}
        className="w-10 h-10 rounded-full bg-[#128c7e]/10 flex items-center justify-center flex-shrink-0 active:bg-[#128c7e]/20">
        {playing
          ? <svg viewBox="0 0 24 24" fill="#128c7e" className="w-4 h-4"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          : <svg viewBox="0 0 24 24" fill="#128c7e" className="w-4 h-4"><path d="M8 5v14l11-7z"/></svg>}
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-slate-800 truncate">{item.file_name||"Voice message"}</p>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-[#128c7e] rounded-full" style={{width:`${dur?(cur/dur)*100:0}%`}}/>
          </div>
          <span className="text-[10px] text-slate-400 flex-shrink-0">{fmtD(dur)}</span>
        </div>
      </div>
      <p className="text-[10px] text-slate-400 flex-shrink-0">
        {new Date(item.created_at).toLocaleDateString([],{day:"numeric",month:"short"})}
      </p>
    </div>
  );
}

function DocItem({ item }) {
  const ext = item.file_name?.split(".").pop()?.toUpperCase()||"FILE";
  const extColors = {PDF:"#ef4444",DOC:"#3b82f6",DOCX:"#3b82f6",XLS:"#22c55e",XLSX:"#22c55e",PPT:"#f97316",PPTX:"#f97316",TXT:"#64748b"};
  const color = extColors[ext]||"#64748b";
  const fmtSize = b => b>1e6?`${(b/1e6).toFixed(1)} MB`:b>1e3?`${Math.round(b/1e3)} KB`:`${b} B`;

  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-50 bg-white active:bg-slate-50">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center font-extrabold text-[10px] text-white flex-shrink-0"
        style={{background:color}}>
        {ext.slice(0,4)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-slate-800 truncate">{item.file_name||"Document"}</p>
        <p className="text-[11px] text-slate-400">{item.file_size?fmtSize(item.file_size):""} · {item.sender_name}</p>
      </div>
      <p className="text-[10px] text-slate-400 flex-shrink-0">
        {new Date(item.created_at).toLocaleDateString([],{day:"numeric",month:"short"})}
      </p>
      <svg viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 flex-shrink-0"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
    </a>
  );
}

function LinkItem({ item }) {
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-50 bg-white active:bg-slate-50">
      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {item.thumbnail_url
          ? <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover"/>
          : <span className="text-xl">🔗</span>}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-slate-800 truncate">{item.link_title||item.url}</p>
        <p className="text-[11px] text-blue-500 truncate">{item.link_domain||item.url}</p>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 flex-shrink-0"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
    </a>
  );
}

export default function MediaHub({ orgId, onBack }) {
  const [activeTab, setActiveTab] = useState("photo");
  const [items,     setItems]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [hasMore,   setHasMore]   = useState(true);
  const [offset,    setOffset]    = useState(0);
  const [preview,   setPreview]   = useState(null);
  const [searchQ,   setSearchQ]   = useState("");

  const load = useCallback(async (type, off=0, q="") => {
    setLoading(true);
    const {data} = await supabase.rpc("search_group_media", {
      p_org_id: orgId, p_media_type: type, p_query: q||null,
      p_limit: PAGE, p_offset: off,
    });
    const rows = data||[];
    if (off===0) setItems(rows); else setItems(prev=>[...prev,...rows]);
    setHasMore(rows.length===PAGE);
    setOffset(off+rows.length);
    setLoading(false);
  }, [orgId]);

  useEffect(()=>{ setItems([]); setOffset(0); setHasMore(true); load(activeTab,0,searchQ); },
    [activeTab, load, searchQ]);

  const loadMore = () => { if(!loading&&hasMore) load(activeTab,offset,searchQ); };

  return (
    <div className="fixed inset-0 z-[125] flex flex-col bg-[#f0f2f5]">

      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-2"
        style={{background:"#075E54",paddingTop:"max(10px,env(safe-area-inset-top))",paddingBottom:"10px"}}>
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10 flex-shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-5 h-5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <span className="flex-1 text-[17px] font-bold text-white">Media Hub</span>
      </div>

      {/* Search */}
      <div className="flex-shrink-0 bg-white border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2 bg-slate-100 rounded-xl px-3 py-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 flex-shrink-0"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder={`Search ${activeTab}s…`}
            className="flex-1 text-sm bg-transparent outline-none text-slate-800 placeholder-slate-400"/>
          {searchQ && <button onClick={()=>setSearchQ("")} className="text-slate-400"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12"/></svg></button>}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 bg-white border-b border-slate-100">
        <div className="flex overflow-x-auto">
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-[12px] font-bold flex-shrink-0 border-b-2 transition-colors
                ${activeTab===t.id?"border-[#128c7e] text-[#128c7e]":"border-transparent text-slate-400"}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" onScroll={e=>{const el=e.target;if(el.scrollHeight-el.scrollTop-el.clientHeight<100)loadMore();}}>
        {loading && items.length===0
          ? <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-[#128c7e] border-t-transparent rounded-full animate-spin"/></div>
          : items.length===0
          ? <div className="flex flex-col items-center py-16 text-slate-400 gap-2">
              <span className="text-5xl">{TABS.find(t=>t.id===activeTab)?.icon}</span>
              <p className="text-sm">No {activeTab}s yet</p>
            </div>
          : (activeTab==="photo"||activeTab==="video")
          ? <PhotoGrid items={items} onTap={setPreview}/>
          : activeTab==="audio"
          ? items.map(m=><AudioItem key={m.id} item={m}/>)
          : activeTab==="document"
          ? items.map(m=><DocItem key={m.id} item={m}/>)
          : items.map(m=><LinkItem key={m.id} item={m}/>)}

        {loading && items.length>0 && (
          <div className="flex justify-center py-4"><div className="w-5 h-5 border-2 border-[#128c7e] border-t-transparent rounded-full animate-spin"/></div>
        )}
        {!hasMore && items.length>0 && (
          <p className="text-center text-xs text-slate-400 py-4">All {activeTab}s loaded</p>
        )}
        <div className="h-6"/>
      </div>

      {/* Photo/Video preview overlay */}
      {preview && (activeTab==="photo"||activeTab==="video") && (
        <div className="fixed inset-0 z-[150] bg-black flex flex-col" onClick={()=>setPreview(null)}>
          <div className="flex items-center gap-2 px-3 py-3 bg-black/50 backdrop-blur-sm flex-shrink-0"
            style={{paddingTop:"max(12px,env(safe-area-inset-top))"}}>
            <button className="w-9 h-9 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-5 h-5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm truncate">{preview.sender_name}</p>
              <p className="text-white/60 text-[11px]">{new Date(preview.created_at).toLocaleDateString([],{day:"numeric",month:"long",year:"numeric"})}</p>
            </div>
            <a href={preview.url} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
              className="w-9 h-9 flex items-center justify-center text-white">⬇️</a>
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            {activeTab==="video"
              ? <video src={preview.url} controls playsInline className="max-w-full max-h-full rounded-xl" onClick={e=>e.stopPropagation()}/>
              : <img src={preview.url} alt="" className="max-w-full max-h-full object-contain rounded-xl" onClick={e=>e.stopPropagation()}/>}
          </div>
        </div>
      )}
    </div>
  );
}
