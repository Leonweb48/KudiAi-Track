import { useState, useEffect } from "react";
import { supabase } from "../../utils/supabase";
import { calcLevel } from "../../utils/communityTypes";
import AdminDashboard  from "./AdminDashboard";
import MediaHub        from "./MediaHub";
import GroupPolls      from "./GroupPolls";
import GroupEvents     from "./GroupEvents";
import VoiceRoom       from "./VoiceRoom";
import PrivacySettings from "./PrivacySettings";
import InviteManager   from "./InviteManager";
import GroupSearch     from "./GroupSearch";
import Leaderboard     from "./Leaderboard";

// ─── Avatar ───────────────────────────────────────────────────────────────────
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

// ─── Role badge ───────────────────────────────────────────────────────────────
const ROLE_STYLE = {
  owner:     { bg:"#fef3c7", text:"#92400e", label:"Owner"    },
  admin:     { bg:"#ede9fe", text:"#6d28d9", label:"Admin"    },
  moderator: { bg:"#dbeafe", text:"#1d4ed8", label:"Mod"      },
  verified:  { bg:"#d1fae5", text:"#065f46", label:"Verified" },
  premium:   { bg:"#fce7f3", text:"#9d174d", label:"Premium"  },
  member:    { bg:"#f1f5f9", text:"#475569", label:"Member"   },
};
function RoleBadge({ role }) {
  const s = ROLE_STYLE[role] ?? ROLE_STYLE.member;
  return <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full" style={{background:s.bg,color:s.text}}>{s.label}</span>;
}

// ─── Level ring ───────────────────────────────────────────────────────────────
function LevelRing({ points=0, size=52 }) {
  const {level,progress} = calcLevel(points);
  const r = (size-8)/2, circ = 2*Math.PI*r;
  return (
    <div className="relative flex-shrink-0" style={{width:size,height:size}}>
      <svg width={size} height={size} className="-rotate-90" style={{position:"absolute",top:0,left:0}}>
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

// ─── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id:"members", label:"Members" },
  { id:"media",   label:"Media"   },
  { id:"events",  label:"Events"  },
  { id:"polls",   label:"Polls"   },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function GroupInfoPage({ orgId, orgName, org, settings: initSettings, members: initMembers,
  onlineIds, lastSeen, isAdmin, myId, onClose }) {

  const [screen,       setScreen]       = useState("info");
  const [activeTab,    setActiveTab]    = useState("members");
  const [settings]                      = useState(initSettings);
  const [members]                       = useState(initMembers || []);
  const [analytics,    setAnalytics]    = useState(null);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [pendingReqs,  setPendingReqs]  = useState(0);
  const [pendingReps,  setPendingReps]  = useState(0);
  const [myMember,     setMyMember]     = useState(null);

  const displayName = settings?.chat_name || `${orgName} Group`;
  const total       = members.length + 1;
  const desc        = settings?.description || "";

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

  const back = () => { setScreen("info"); setActiveTab("members"); };

  const handleTab = (id) => {
    if (id === "members") { setActiveTab("members"); return; }
    setScreen(id);
  };

  const filteredMembers = memberSearch.trim()
    ? members.filter(m => m.full_name?.toLowerCase().includes(memberSearch.toLowerCase()))
    : members;

  const myLevel = calcLevel(myMember?.reputation_points || 0);

  // ── Sub-screens ───────────────────────────────────────────────────────────
  if (screen==="search")      return <GroupSearch    orgId={orgId} members={members} onBack={back}/>;
  if (screen==="media")       return <MediaHub        orgId={orgId} onBack={back}/>;
  if (screen==="polls")       return <GroupPolls  orgId={orgId} myId={myId} isAdmin={isAdmin} myName={myMember?.full_name || orgName || "Admin"} myRole={isAdmin ? "admin" : "member"} onBack={back}/>;
  if (screen==="events")      return <GroupEvents orgId={orgId} myId={myId} isAdmin={isAdmin} myName={myMember?.full_name || orgName || "Admin"} myRole={isAdmin ? "admin" : "member"} onBack={back}/>;
  if (screen==="voice")       return <VoiceRoom       orgId={orgId} myId={myId} myName={myMember?.full_name||"Member"} avatarUrl={myMember?.avatar_url} isAdmin={isAdmin} onBack={back}/>;
  if (screen==="leaderboard") return <Leaderboard     orgId={orgId} myId={myId} onBack={back}/>;
  if (screen==="privacy")     return <PrivacySettings orgId={orgId} isAdmin={isAdmin} onBack={back}/>;
  if (screen==="invites")     return <InviteManager   orgId={orgId} myId={myId} onBack={back}/>;
  if (screen==="admin")       return <AdminDashboard  orgId={orgId} orgName={orgName} org={org} members={members}
    onlineIds={onlineIds} lastSeen={lastSeen} myId={myId} analytics={analytics}
    pendingReqs={pendingReqs} pendingReps={pendingReps}
    onNavigate={setScreen} onClose={back}/>;

  // ── Info screen ───────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-white">

      {/* Floating header — overlays the banner */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 pointer-events-none"
        style={{paddingTop:"max(10px,env(safe-area-inset-top))",paddingBottom:"8px"}}>
        <button onClick={onClose} className="pointer-events-auto w-9 h-9 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center active:bg-black/65 transition-colors">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-5 h-5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <div className="flex gap-2 pointer-events-auto">
          <button onClick={()=>setScreen("search")} className="w-9 h-9 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center active:bg-black/65 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" className="w-4 h-4"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          </button>
          {isAdmin && (
            <button onClick={()=>setScreen("admin")} className="w-9 h-9 rounded-full bg-black/45 backdrop-blur-md flex items-center justify-center active:bg-black/65 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" className="w-4 h-4">
                <circle cx="12" cy="5" r="1.5" fill="white"/><circle cx="12" cy="12" r="1.5" fill="white"/><circle cx="12" cy="19" r="1.5" fill="white"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto overscroll-none">

        {/* ── Banner ── */}
        <div className="relative flex-shrink-0"
          style={{height:210,background:"linear-gradient(160deg,#022c22 0%,#064e3b 40%,#065f46 70%,#128c7e 100%)"}}>
          {/* decorative pattern */}
          <div className="absolute inset-0 opacity-[0.07]"
            style={{backgroundImage:"radial-gradient(circle,white 1.5px,transparent 1.5px)",backgroundSize:"28px 28px"}}/>
          {/* subtle glow */}
          <div className="absolute bottom-0 left-0 right-0 h-20 pointer-events-none"
            style={{background:"linear-gradient(to top,rgba(0,0,0,0.18),transparent)"}}/>
          {settings?.is_private && (
            <span className="absolute top-4 right-4 text-[10px] font-extrabold text-white bg-black/30 backdrop-blur-sm px-2.5 py-1 rounded-full">🔒 Private</span>
          )}
        </div>

        {/* ── Profile card ── */}
        <div className="bg-white px-4 pb-2">

          {/* Avatar row: overlaps banner */}
          <div className="flex items-end justify-between" style={{marginTop:-52}}>
            <div className="w-[100px] h-[100px] rounded-full border-4 border-white shadow-xl overflow-hidden flex-shrink-0"
              style={{background:"linear-gradient(145deg,#075E54,#128c7e)"}}>
              {org?.logo_url
                ? <img src={org.logo_url} alt={displayName} className="w-full h-full object-cover"/>
                : <div className="w-full h-full flex items-center justify-center text-4xl">{settings?.emoji||"💬"}</div>}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 items-center pb-2 pt-14">
              {isAdmin && (
                <button onClick={()=>setScreen("privacy")}
                  className="px-4 py-1.5 border-2 border-slate-200 rounded-full text-[13px] font-extrabold text-slate-700 bg-white active:bg-slate-50 transition-colors shadow-sm">
                  Settings
                </button>
              )}
              <button onClick={()=>setScreen("invites")}
                className="px-5 py-1.5 bg-slate-900 rounded-full text-[13px] font-extrabold text-white active:bg-slate-700 transition-colors shadow-sm">
                Invite
              </button>
            </div>
          </div>

          {/* Name + verified */}
          <div className="mt-3 flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h1 className="text-[21px] font-extrabold text-slate-900 leading-tight">{displayName}</h1>
                {settings?.is_verified && (
                  <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" fill="#128c7e">
                    <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                  </svg>
                )}
              </div>
              <p className="text-[14px] text-slate-500 mt-0.5 leading-snug">
                Group · {total} members
                {settings?.category ? ` · ${settings.category}` : ""}
              </p>
            </div>
          </div>

          {/* Bio / description */}
          {desc && (
            <p className="text-[14px] text-slate-800 leading-relaxed mt-3">
              {showFullDesc || desc.length <= 160 ? desc : desc.slice(0,160)+"…"}
              {desc.length > 160 && (
                <button onClick={()=>setShowFullDesc(s=>!s)} className="text-[#128c7e] font-semibold ml-1">
                  {showFullDesc?"less":"more"}
                </button>
              )}
            </p>
          )}

          {/* Meta row */}
          {(org?.address || org?.website || settings?.created_at) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {org?.address && (
                <span className="flex items-center gap-1 text-[13px] text-slate-500">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-3.5 h-3.5">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                  {org.address}
                </span>
              )}
              {org?.website && (
                <a href={org.website} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 text-[13px] text-[#128c7e] font-medium">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-3.5 h-3.5">
                    <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                  </svg>
                  {org.website.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>
          )}

          {/* Stats row (X-style inline numbers) */}
          <div className="flex items-center gap-5 mt-3 flex-wrap">
            <button onClick={()=>setActiveTab("members")} className="flex items-baseline gap-1 active:opacity-70">
              <span className="text-[15px] font-extrabold text-slate-900">{total}</span>
              <span className="text-[14px] text-slate-500">Members</span>
            </button>
            <div className="flex items-baseline gap-1">
              <span className="text-[15px] font-extrabold text-slate-900">{onlineIds.length}</span>
              <span className="text-[14px] text-slate-500">Online</span>
            </div>
            {analytics && (
              <>
                <div className="flex items-baseline gap-1">
                  <span className="text-[15px] font-extrabold text-slate-900">{analytics.total_messages ?? 0}</span>
                  <span className="text-[14px] text-slate-500">Posts</span>
                </div>
                {analytics.events_created > 0 && (
                  <div className="flex items-baseline gap-1">
                    <span className="text-[15px] font-extrabold text-slate-900">{analytics.events_created}</span>
                    <span className="text-[14px] text-slate-500">Events</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* My level card */}
          {myMember && (
            <div className="mt-4 p-3 bg-gradient-to-r from-[#f0fdf4] to-[#dcfce7] rounded-2xl border border-[#bbf7d0] flex items-center gap-3">
              <LevelRing points={myMember.reputation_points} size={52}/>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-extrabold text-slate-800">{myLevel.title}</p>
                <p className="text-[11px] text-slate-500">{myMember.reputation_points} pts · {myLevel.pointsToNext} to next level</p>
                <div className="mt-1.5 h-1.5 bg-white/70 rounded-full overflow-hidden">
                  <div className="h-full bg-[#25d366] rounded-full" style={{width:`${myLevel.progress}%`}}/>
                </div>
              </div>
              <button onClick={()=>setScreen("leaderboard")}
                className="text-[11px] font-extrabold text-[#128c7e] bg-white px-3 py-1.5 rounded-xl shadow-sm active:bg-[#f0fdf4]">
                Rank
              </button>
            </div>
          )}

          {/* Admin quick-row */}
          {isAdmin && (
            <div className="mt-3 flex gap-2">
              <button onClick={()=>setScreen("admin")}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-50 hover:bg-slate-100 rounded-2xl border border-slate-200 active:bg-slate-100 transition-colors">
                <svg viewBox="0 0 24 24" fill="none" stroke="#6d28d9" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 flex-shrink-0">
                  <path d="M12 2a10 10 0 110 20A10 10 0 0112 2zm0 6v4m0 4h.01"/>
                </svg>
                <span className="text-[13px] font-bold text-slate-700">Dashboard</span>
                {(pendingReqs+pendingReps) > 0 && (
                  <span className="bg-red-500 text-white text-[9px] font-extrabold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0">
                    {pendingReqs+pendingReps}
                  </span>
                )}
              </button>
              <button onClick={()=>setScreen("voice")}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-50 hover:bg-slate-100 rounded-2xl border border-slate-200 active:bg-slate-100 transition-colors">
                <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 flex-shrink-0">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8"/>
                </svg>
                <span className="text-[13px] font-bold text-slate-700">Voice Room</span>
              </button>
            </div>
          )}
        </div>

        {/* ── Sticky tab bar ── */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200">
          <div className="flex">
            {TABS.map(t => {
              const active = activeTab === t.id;
              return (
                <button key={t.id} onClick={()=>handleTab(t.id)}
                  className={`flex-1 py-3.5 text-center relative transition-colors
                    ${active ? "text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                  <span className="text-[14px] font-bold">{t.label}</span>
                  {active && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[3px] w-10 bg-[#128c7e] rounded-full"/>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Members tab content ── */}
        {activeTab === "members" && (
          <div className="bg-white">

            {/* Search bar */}
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5 bg-slate-100 rounded-full px-4 py-2.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 flex-shrink-0">
                  <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                </svg>
                <input value={memberSearch} onChange={e=>setMemberSearch(e.target.value)}
                  placeholder="Search members…"
                  className="flex-1 text-[14px] text-slate-800 bg-transparent outline-none placeholder-slate-400"/>
                {memberSearch && (
                  <button onClick={()=>setMemberSearch("")} className="text-slate-400 flex-shrink-0">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                )}
              </div>
            </div>

            {/* Admin row */}
            <div className="flex items-center gap-3.5 px-4 py-3.5 border-b border-slate-50 active:bg-slate-50 transition-colors">
              <Av name={org?.owner_name||orgName} size={46} online url={org?.logo_url}/>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-[15px] font-bold text-slate-900 truncate">{org?.owner_name||orgName}</p>
                  <RoleBadge role="owner"/>
                </div>
                <p className="text-[12px] text-[#128c7e] font-medium mt-0.5">Group admin · online</p>
              </div>
            </div>

            {/* Members */}
            {filteredMembers.map((m, idx) => {
              const online = onlineIds.includes(m.user_id);
              const {level} = calcLevel(m.reputation_points||0);
              return (
                <div key={m.id}
                  className={`flex items-center gap-3.5 px-4 py-3.5 active:bg-slate-50 transition-colors
                    ${idx < filteredMembers.length-1 ? "border-b border-slate-50" : ""}`}>
                  <Av name={m.full_name} size={46} online={online} url={m.avatar_url||m.profile_image_url}/>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[15px] font-bold text-slate-900 truncate">{m.full_name}</p>
                      <RoleBadge role={m.chat_role||"member"}/>
                      {m.badge_count > 0 && <span className="text-[9px] text-amber-600 font-bold">🏅×{m.badge_count}</span>}
                    </div>
                    <p className={`text-[12px] font-medium mt-0.5 ${online ? "text-[#128c7e]" : "text-slate-400"}`}>
                      {online
                        ? "online"
                        : `last seen ${lastSeen[m.user_id] ? new Date(lastSeen[m.user_id]).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) : "—"}`}
                      {m.reputation_points > 0 && <span className="ml-2 text-slate-300">· Lv{level}</span>}
                    </p>
                  </div>
                </div>
              );
            })}

            {filteredMembers.length === 0 && memberSearch && (
              <div className="py-12 text-center text-sm text-slate-400">No members found</div>
            )}

            <div className="h-12"/>
          </div>
        )}

      </div>
    </div>
  );
}
