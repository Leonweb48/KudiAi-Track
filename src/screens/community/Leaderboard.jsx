import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../utils/supabase";
import { calcLevel } from "../../utils/communityTypes";

const LEVEL_COLORS = [
  "","#64748b","#3b82f6","#8b5cf6","#10b981",
  "#f59e0b","#ef4444","#ec4899","#06b6d4","#f97316","#eab308",
];

const MEDALS = ["🥇","🥈","🥉"];

function LevelRing({ level, points, size=56 }) {
  const { progress } = calcLevel(points);
  const r  = (size/2)-5;
  const c  = 2*Math.PI*r;
  const cl = LEVEL_COLORS[Math.min(level,10)]||"#64748b";
  return (
    <div className="relative flex-shrink-0" style={{width:size,height:size}}>
      <svg width={size} height={size} className="-rotate-90" style={{position:"absolute",inset:0}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={4}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={cl} strokeWidth={4}
          strokeDasharray={c} strokeDashoffset={c*(1-progress/100)} strokeLinecap="round"/>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-extrabold" style={{fontSize:size*0.28,color:cl,lineHeight:1}}>{level}</span>
      </div>
    </div>
  );
}

function BadgeChip({ badge }) {
  return (
    <div className="flex items-center gap-1 bg-slate-100 rounded-full px-2 py-0.5"
      title={badge.badge_name}>
      <span className="text-[13px]">{badge.badge_icon||"🏅"}</span>
      <span className="text-[10px] font-bold text-slate-600 hidden sm:block">{badge.badge_name}</span>
    </div>
  );
}

function RankRow({ entry, rank, myId }) {
  const isMe = entry.user_id===myId;
  const { level, title } = calcLevel(entry.reputation_points||0);
  const cl = LEVEL_COLORS[Math.min(level,10)]||"#64748b";

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-slate-50 ${isMe?"bg-[#dcf8c6]/40":"bg-white"}`}>
      <div className="w-8 text-center flex-shrink-0">
        {rank<=3
          ? <span className="text-lg">{MEDALS[rank-1]}</span>
          : <span className="text-[14px] font-bold text-slate-400">#{rank}</span>}
      </div>
      <div className="w-10 h-10 rounded-full bg-[#128c7e] flex items-center justify-center text-white text-sm font-bold flex-shrink-0 overflow-hidden">
        {entry.avatar_url
          ? <img src={entry.avatar_url} alt="" className="w-full h-full object-cover"/>
          : (entry.display_name||"?")[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[14px] font-bold text-slate-800 truncate">{entry.display_name}{isMe?" (you)":""}</p>
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{background:cl}}>{title}</span>
          {(entry.badges||[]).slice(0,3).map((b,i)=><BadgeChip key={i} badge={b}/>)}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <LevelRing level={level} points={entry.reputation_points||0} size={40}/>
      </div>
      <div className="text-right flex-shrink-0 min-w-[48px]">
        <p className="text-[13px] font-extrabold text-[#128c7e]">{(entry.reputation_points||0).toLocaleString()}</p>
        <p className="text-[10px] text-slate-400">points</p>
      </div>
    </div>
  );
}

function MyCard({ me, rank }) {
  if(!me) return null;
  const { level, title, progress, pointsToNext } = calcLevel(me.reputation_points||0);
  const cl = LEVEL_COLORS[Math.min(level,10)]||"#64748b";

  return (
    <div className="mx-4 my-3 bg-white rounded-2xl shadow-sm overflow-hidden">
      <div className="p-4 flex items-center gap-4">
        <LevelRing level={level} points={me.reputation_points||0} size={64}/>
        <div className="flex-1 min-w-0">
          <p className="text-[16px] font-extrabold text-slate-900">{me.display_name}</p>
          <p className="text-[12px] font-bold" style={{color:cl}}>{title}</p>
          <div className="mt-2">
            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
              <span>Progress to Level {level+1}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{width:`${progress}%`,background:cl}}/>
            </div>
            {pointsToNext>0 && <p className="text-[10px] text-slate-400 mt-1">{pointsToNext} pts to next level</p>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[11px] text-slate-400">Rank</p>
          <p className="text-[24px] font-extrabold text-[#128c7e] leading-none">#{rank||"—"}</p>
        </div>
      </div>
      {(me.badges||[]).length>0 && (
        <div className="px-4 pb-4 flex flex-wrap gap-1.5">
          {me.badges.map((b,i)=><BadgeChip key={i} badge={b}/>)}
        </div>
      )}
    </div>
  );
}

export default function Leaderboard({ orgId, myId, onBack }) {
  const [entries,  setEntries]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [myEntry,  setMyEntry]  = useState(null);
  const [myRank,   setMyRank]   = useState(null);

  const load = useCallback(async()=>{
    setLoading(true);
    const {data}=await supabase.from("group_leaderboard").select("*").eq("org_id",orgId).limit(100);
    const rows=data||[];
    setEntries(rows);
    const myIdx=rows.findIndex(r=>r.user_id===myId);
    if(myIdx>=0){ setMyEntry(rows[myIdx]); setMyRank(myIdx+1); }
    setLoading(false);
  },[orgId,myId]);

  useEffect(()=>{ load(); },[load]);

  const top = entries.slice(0,3);

  return (
    <div className="fixed inset-0 z-[125] flex flex-col bg-[#f0f2f5]">
      <div className="flex-shrink-0 flex items-center gap-2 px-2"
        style={{background:"#075E54",paddingTop:"max(10px,env(safe-area-inset-top))",paddingBottom:"10px"}}>
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10 flex-shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-5 h-5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <span className="flex-1 text-[17px] font-bold text-white">Leaderboard</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading
          ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#128c7e] border-t-transparent rounded-full animate-spin"/></div>
          : <>
              {/* Podium */}
              {top.length>=3 && (
                <div className="bg-gradient-to-b from-[#075E54] to-[#f0f2f5] pt-4 pb-6 px-4 flex items-end justify-center gap-3">
                  {[top[1],top[0],top[2]].map((e,i)=>{
                    const pos = i===0?2:i===1?1:3;
                    const heights = [80,100,70];
                    const sizes = [52,64,48];
                    const cl = LEVEL_COLORS[Math.min(calcLevel(e.reputation_points||0).level,10)];
                    return (
                      <div key={e.user_id} className="flex flex-col items-center gap-1.5">
                        <span className="text-2xl">{MEDALS[pos-1]}</span>
                        <div className="rounded-full overflow-hidden bg-white border-2 border-white flex items-center justify-center text-[#128c7e] font-extrabold"
                          style={{width:sizes[i],height:sizes[i],fontSize:sizes[i]*0.38}}>
                          {e.avatar_url
                            ? <img src={e.avatar_url} alt="" className="w-full h-full object-cover"/>
                            : (e.display_name||"?")[0].toUpperCase()}
                        </div>
                        <p className="text-white font-bold text-[11px] text-center max-w-[64px] truncate">{e.display_name?.split(" ")[0]}</p>
                        <p className="font-extrabold text-[13px]" style={{color:cl}}>{(e.reputation_points||0).toLocaleString()}</p>
                        <div className="bg-white/20 rounded-xl flex items-end justify-center w-14"
                          style={{height:heights[i]}}>
                          <p className="text-white font-extrabold text-[22px] mb-1">#{pos}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* My card */}
              {myEntry && <MyCard me={myEntry} rank={myRank}/>}

              {/* Full list */}
              <div className="bg-white rounded-t-2xl overflow-hidden">
                {entries.length===0
                  ? <div className="flex flex-col items-center py-16 text-slate-400 gap-2"><span className="text-5xl">🏆</span><p className="text-sm">No scores yet</p></div>
                  : entries.map((e,i)=><RankRow key={e.user_id} entry={e} rank={i+1} myId={myId}/>)}
              </div>
              <div className="h-6"/>
            </>}
      </div>
    </div>
  );
}
