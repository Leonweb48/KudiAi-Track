import { useState, useEffect } from "react";
import { supabase } from "../../utils/supabase";
import { calcLevel } from "../../utils/communityTypes";
import AdminDashboard   from "./AdminDashboard";
import MediaHub         from "./MediaHub";
import GroupPolls       from "./GroupPolls";
import GroupEvents      from "./GroupEvents";
import VoiceRoom        from "./VoiceRoom";
import PrivacySettings  from "./PrivacySettings";
import InviteManager    from "./InviteManager";
import GroupSearch      from "./GroupSearch";
import Leaderboard      from "./Leaderboard";

// ─── Shared Avatar ────────────────────────────────────────────────────────────
const AC = ["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f43f5e"];
function ac(name=""){let h=0;for(const c of name)h=(h*31+c.charCodeAt(0))|0;return AC[Math.abs(h)%AC.length];}
function Av({ name="?", size=40, url, online }) {
  const [err,setErr]=useState(false);
  return (
    <div className="relative flex-shrink-0" style={{width:size,height:size}}>
      {url&&!err
        ? <img src={url} alt={name} className="w-full h-full rounded-full object-cover" onError={()=>setErr(true)}/>
        : <div className="w-full h-full rounded-full flex items-center justify-center font-bold text-white"
            style={{fontSize:size*0.38,background:ac(name)}}>{name.charAt(0).toUpperCase()}</div>}
      {online && <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-white"/>}
    </div>
  );
}

// ─── Role badge chip ──────────────────────────────────────────────────────────
const ROLE_STYLE = {
  owner:     { bg:"#fef3c7", text:"#92400e", label:"Owner"     },
  admin:     { bg:"#ede9fe", text:"#6d28d9", label:"Admin"     },
  moderator: { bg:"#dbeafe", text:"#1d4ed8", label:"Mod"       },
  verified:  { bg:"#d1fae5", text:"#065f46", label:"Verified"  },
  premium:   { bg:"#fce7f3", text:"#9d174d", label:"Premium"   },
  member:    { bg:"#f1f5f9", text:"#475569", label:"Member"    },
};
function RoleBadge({ role }) {
  const s = ROLE_STYLE[role] ?? ROLE_STYLE.member;
  return <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full" style={{background:s.bg,color:s.text}}>{s.label}</span>;
}

// ─── Level ring ───────────────────────────────────────────────────────────────
function LevelRing({ points=0, size=56 }) {
  const {level,progress} = calcLevel(points);
  const r = (size-8)/2, circ = 2*Math.PI*r;
  return (
    <div className="relative flex-shrink-0" style={{width:size,height:size}}>
      <svg width={size} height={size} className="-rotate-90" style={{position:'absolute',top:0,left:0}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="4"/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#25d366" strokeWidth="4"
          strokeDasharray={circ} strokeDashoffset={circ*(1-progress/100)} strokeLinecap="round"/>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center flex-col">
        <span className="text-[11px] font-extrabold text-slate-800 leading-none">{level}</span>
        <span className="text-[8px] text-slate-400 leading-none">LVL</span>
      </div>
    </div>
  );
}

// ─── Action button ────────────────────────────────────────────────────────────
function ActionBtn({ icon, label, badge, onClick, color="#075E54" }) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-1.5 active:opacity-70 transition-opacity min-w-[56px]">
      <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-sm" style={{background:color+"18"}}>
        <span className="text-xl">{icon}</span>
        {badge > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-1">{badge}</span>
        )}
      </div>
      <span className="text-[10px] font-semibold text-slate-600 leading-tight text-center">{label}</span>
    </button>
  );
}

// ─── Stat chip ────────────────────────────────────────────────────────────────
function StatChip({ label, value, icon }) {
  return (
    <div className="flex flex-col items-center bg-white rounded-2xl px-4 py-3 shadow-sm min-w-[80px]">
      <span className="text-lg">{icon}</span>
      <span className="text-[16px] font-extrabold text-slate-800 leading-tight">{value}</span>
      <span className="text-[9px] text-slate-400 uppercase tracking-wide mt-0.5">{label}</span>
    </div>
  );
}

// ─── Main GroupInfoPage ───────────────────────────────────────────────────────
export default function GroupInfoPage({ orgId, orgName, org, settings: initSettings, members: initMembers,
  onlineIds, lastSeen, isAdmin, myId, onClose }) {

  const [screen,   setScreen] = useState("info");
  const [settings]            = useState(initSettings);
  const [members]             = useState(initMembers || []);
  const [analytics,    setAnalytics]    = useState(null);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [showMSearch,  setShowMSearch]  = useState(false);
  const [pendingReqs,  setPendingReqs]  = useState(0);
  const [pendingReps,  setPendingReps]  = useState(0);
  const [myMember,     setMyMember]     = useState(null);

  const displayName = settings?.chat_name || `${orgName} Group`;
  const total = members.length + 1;
  const desc  = settings?.description || "";

  useEffect(() => {
    if (!orgId || !isAdmin) return;
    Promise.all([
      supabase.from("group_join_requests").select("id",{count:"exact",head:true}).eq("org_id",orgId).eq("status","pending"),
      supabase.from("group_reports").select("id",{count:"exact",head:true}).eq("org_id",orgId).eq("status","pending"),
      supabase.rpc("get_group_analytics",{p_org_id:orgId,p_days:30}),
    ]).then(([reqR,repR,analR]) => {
      setPendingReqs(reqR.count || 0);
      setPendingReps(repR.count || 0);
      if (analR.data) setAnalytics(analR.data);
    });
  }, [orgId, isAdmin]);

  useEffect(() => {
    if (!myId || !orgId) return;
    supabase.from("org_members").select("*").eq("org_id",orgId).eq("user_id",myId).maybeSingle()
      .then(({data}) => setMyMember(data));
  }, [myId, orgId]);

  const filteredMembers = memberSearch.trim()
    ? members.filter(m => m.full_name?.toLowerCase().includes(memberSearch.toLowerCase()))
    : members;

  const myLevel = calcLevel(myMember?.reputation_points || 0);

  // ── Sub-screen navigation ──────────────────────────────────────────────────
  if (screen === "search")   return <GroupSearch   orgId={orgId} members={members} onBack={()=>setScreen("info")} />;
  if (screen === "media")    return <MediaHub       orgId={orgId} onBack={()=>setScreen("info")} />;
  if (screen === "polls")    return <GroupPolls     orgId={orgId} myId={myId} isAdmin={isAdmin} onBack={()=>setScreen("info")} />;
  if (screen === "events")   return <GroupEvents    orgId={orgId} myId={myId} isAdmin={isAdmin} onBack={()=>setScreen("info")} />;
  if (screen === "voice")    return <VoiceRoom      orgId={orgId} myId={myId} myName={myMember?.full_name||"Member"} avatarUrl={myMember?.avatar_url} isAdmin={isAdmin} onBack={()=>setScreen("info")} />;
  if (screen === "leaderboard") return <Leaderboard orgId={orgId} myId={myId} onBack={()=>setScreen("info")} />;
  if (screen === "privacy")  return <PrivacySettings orgId={orgId} isAdmin={isAdmin} onBack={()=>setScreen("info")} />;
  if (screen === "invites")  return <InviteManager  orgId={orgId} myId={myId} onBack={()=>setScreen("info")} />;
  if (screen === "admin")    return <AdminDashboard  orgId={orgId} orgName={orgName} org={org} members={members}
    onlineIds={onlineIds} lastSeen={lastSeen} myId={myId} analytics={analytics}
    pendingReqs={pendingReqs} pendingReps={pendingReps}
    onNavigate={setScreen} onClose={()=>setScreen("info")} />;

  // ── INFO screen ────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-[#f0f2f5]">

      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-2"
        style={{background:"#075E54",paddingTop:"max(10px,env(safe-area-inset-top))",paddingBottom:"10px"}}>
        <button onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10 flex-shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-5 h-5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <span className="flex-1 text-[17px] font-bold text-white">Group info</span>
        <button onClick={()=>setScreen("search")} className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" className="w-4.5 h-4.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── Identity ── */}
        <div className="bg-white">
          {/* Avatar + name */}
          <div className="flex flex-col items-center pt-6 pb-4 px-5">
            <div className="w-[88px] h-[88px] rounded-full border-4 border-white shadow-lg overflow-hidden flex-shrink-0 mb-3"
              style={{background:"linear-gradient(145deg,#075E54,#128c7e)"}}>
              {org?.logo_url
                ? <img src={org.logo_url} alt={displayName} className="w-full h-full object-cover"/>
                : <div className="w-full h-full flex items-center justify-center text-3xl">{settings?.emoji||"💬"}</div>}
            </div>
            <p className="text-[22px] font-extrabold text-slate-900 text-center leading-tight">{displayName}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap justify-center">
              <p className="text-[13px] text-[#128c7e] font-medium">Group · {total} members</p>
              {settings?.category && (
                <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{settings.category}</span>
              )}
              {settings?.is_private && (
                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">🔒 Private</span>
              )}
              {settings?.is_verified && (
                <span className="text-[10px] font-bold text-[#065f46] bg-[#d1fae5] px-2 py-0.5 rounded-full">✓ Verified</span>
              )}
            </div>
          </div>

          {/* Description */}
          {desc && (
            <div className="px-5 pb-4 border-t border-slate-50 pt-3">
              <p className="text-sm text-slate-700 leading-relaxed">
                {showFullDesc || desc.length <= 120 ? desc : desc.slice(0,120)+"…"}
                {desc.length > 120 && (
                  <button onClick={()=>setShowFullDesc(s=>!s)} className="text-[#128c7e] font-semibold ml-1">
                    {showFullDesc?"Read less":"Read more"}
                  </button>
                )}
              </p>
            </div>
          )}

          {/* My level card (if member) */}
          {myMember && (
            <div className="mx-4 mb-4 p-3 bg-gradient-to-r from-[#f0fdf4] to-[#dcfce7] rounded-2xl border border-[#bbf7d0] flex items-center gap-3">
              <LevelRing points={myMember.reputation_points} size={52}/>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-extrabold text-slate-800">{myLevel.title}</p>
                <p className="text-[11px] text-slate-500">{myMember.reputation_points} pts · {myLevel.pointsToNext} to next level</p>
                <div className="mt-1.5 h-1.5 bg-white/70 rounded-full overflow-hidden">
                  <div className="h-full bg-[#25d366] rounded-full transition-all" style={{width:`${myLevel.progress}%`}}/>
                </div>
              </div>
              <button onClick={()=>setScreen("leaderboard")} className="text-[11px] font-bold text-[#128c7e] bg-white px-3 py-1.5 rounded-xl shadow-sm active:bg-[#f0fdf4]">
                Rank
              </button>
            </div>
          )}
        </div>

        {/* ── Stats row ── */}
        {analytics && (
          <>
            <div className="h-3 bg-[#f0f2f5]"/>
            <div className="bg-white px-4 py-4">
              <div className="flex gap-3 overflow-x-auto pb-1">
                <StatChip icon="👥" label="Members"   value={analytics.total_members}    />
                <StatChip icon="💬" label="Messages"  value={analytics.total_messages}   />
                <StatChip icon="🔴" label="Online"    value={onlineIds.length}           />
                <StatChip icon="📊" label="Polls"     value={analytics.polls_created}    />
                <StatChip icon="📅" label="Events"    value={analytics.events_created}   />
                <StatChip icon="🎙️" label="Voices"    value={analytics.voice_sessions}   />
              </div>
            </div>
          </>
        )}

        {/* ── Action grid ── */}
        <div className="h-3 bg-[#f0f2f5]"/>
        <div className="bg-white px-4 py-4">
          <div className="flex flex-wrap gap-4 justify-around">
            <ActionBtn icon="📅" label="Events"   onClick={()=>setScreen("events")}      color="#f59e0b"/>
            <ActionBtn icon="📊" label="Polls"    onClick={()=>setScreen("polls")}       color="#8b5cf6"/>
            <ActionBtn icon="🖼️"  label="Media"   onClick={()=>setScreen("media")}       color="#06b6d4"/>
            <ActionBtn icon="🎙️" label="Voice"   onClick={()=>setScreen("voice")}       color="#ef4444"/>
            <ActionBtn icon="🏆" label="Ranks"   onClick={()=>setScreen("leaderboard")} color="#f59e0b"/>
          </div>
        </div>

        {/* ── Admin section ── */}
        {isAdmin && (
          <>
            <div className="h-3 bg-[#f0f2f5]"/>
            <div className="bg-white">
              <button onClick={()=>setScreen("admin")}
                className="w-full flex items-center gap-4 px-5 py-4 border-b border-slate-50 active:bg-slate-50">
                <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xl">⚙️</span>
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[14px] font-semibold text-slate-800">Admin Dashboard</p>
                  <p className="text-[11px] text-slate-400">Members, analytics, reports</p>
                </div>
                {(pendingReqs+pendingReps)>0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{pendingReqs+pendingReps}</span>
                )}
                <svg viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 flex-shrink-0"><path d="M9 18l6-6-6-6"/></svg>
              </button>
              <button onClick={()=>setScreen("privacy")}
                className="w-full flex items-center gap-4 px-5 py-4 active:bg-slate-50">
                <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <span className="text-xl">🔒</span>
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[14px] font-semibold text-slate-800">Privacy & Settings</p>
                  <p className="text-[11px] text-slate-400">Disappearing messages, slow mode</p>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 flex-shrink-0"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
          </>
        )}

        {/* ── Members list ── */}
        <div className="h-3 bg-[#f0f2f5]"/>
        <div className="bg-white">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <span className="text-[15px] font-semibold text-slate-800">{total} participants</span>
            <button onClick={()=>setShowMSearch(s=>!s)}
              className="w-8 h-8 flex items-center justify-center rounded-full active:bg-slate-100">
              <svg viewBox="0 0 24 24" fill="none" stroke="#8a9bb0" strokeWidth={2} strokeLinecap="round" className="w-4 h-4"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            </button>
          </div>

          {showMSearch && (
            <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-slate-200">
                <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 flex-shrink-0"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                <input value={memberSearch} onChange={e=>setMemberSearch(e.target.value)} autoFocus
                  placeholder="Search participants…"
                  className="flex-1 text-sm text-slate-800 bg-transparent outline-none placeholder-slate-400"/>
                {memberSearch && (
                  <button onClick={()=>setMemberSearch("")} className="text-slate-400">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Org admin row */}
          <div className="flex items-center gap-3.5 px-4 py-3.5 border-b border-slate-50">
            <Av name={org?.owner_name||orgName} size={50} online url={org?.logo_url}/>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-[14px] font-semibold text-slate-900 truncate">{org?.owner_name||orgName}</p>
                <RoleBadge role="owner"/>
              </div>
              <p className="text-[12px] text-[#128c7e] font-medium">Group admin · online</p>
            </div>
          </div>

          {filteredMembers.map((m,idx) => {
            const online = onlineIds.includes(m.user_id);
            const {level} = calcLevel(m.reputation_points||0);
            return (
              <div key={m.id}
                className={`flex items-center gap-3.5 px-4 py-3.5 ${idx<filteredMembers.length-1?"border-b border-slate-50":""}`}>
                <Av name={m.full_name} size={50} online={online} url={m.avatar_url||m.profile_image_url}/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-[14px] font-semibold text-slate-900 truncate">{m.full_name}</p>
                    <RoleBadge role={m.chat_role||"member"}/>
                    {m.badge_count>0 && <span className="text-[9px] text-amber-600 font-bold">🏅×{m.badge_count}</span>}
                  </div>
                  <p className={`text-[12px] font-medium ${online?"text-[#128c7e]":"text-slate-400"}`}>
                    {online?"online":`last seen ${lastSeen[m.user_id]?new Date(lastSeen[m.user_id]).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—'}`}
                    {m.reputation_points>0 && <span className="ml-2 text-slate-300">· Lv{level}</span>}
                  </p>
                </div>
              </div>
            );
          })}

          {filteredMembers.length===0 && memberSearch && (
            <div className="px-5 py-8 text-center text-sm text-slate-400">No participants found</div>
          )}
        </div>
        <div className="h-10"/>
      </div>
    </div>
  );
}
