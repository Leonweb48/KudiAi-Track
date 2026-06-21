import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../utils/supabase";
const fmtDate = ts => new Date(ts).toLocaleDateString([],{day:"numeric",month:"short",year:"numeric"});

const TABS = ["Overview","Members","Requests","Reports","Invites","Settings"];

const BADGE_COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#8b5cf6"];
const AC=["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f43f5e"];
function ac(n=""){let h=0;for(const c of n)h=(h*31+c.charCodeAt(0))|0;return AC[Math.abs(h)%AC.length];}
function Av({name="?",size=38,url}){const[e,setE]=useState(false);return(
  <div className="relative flex-shrink-0" style={{width:size,height:size}}>
    {url&&!e?<img src={url} alt={name} className="w-full h-full rounded-full object-cover" onError={()=>setE(true)}/>
    :<div className="w-full h-full rounded-full flex items-center justify-center font-bold text-white text-sm"
      style={{background:ac(name)}}>{name.charAt(0).toUpperCase()}</div>}
  </div>
);}

function StatCard({icon,label,value,sub,color="#128c7e"}){
  return(
    <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-1">
      <span className="text-2xl">{icon}</span>
      <p className="text-[22px] font-extrabold text-slate-900 leading-none">{value}</p>
      <p className="text-[11px] font-semibold text-slate-600">{label}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

function SectionHeader({title, action, onAction}){
  return(
    <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
      <span className="text-[13px] font-extrabold text-slate-400 uppercase tracking-wider">{title}</span>
      {action && <button onClick={onAction} className="text-[12px] font-bold text-[#128c7e]">{action}</button>}
    </div>
  );
}

export default function AdminDashboard({ orgId, orgName, org, members:initMembers, onlineIds, lastSeen,
  myId, analytics, pendingReqs, pendingReps, onNavigate, onClose }) {

  const [tab,        setTab]        = useState("Overview");
  const [members,    setMembers]    = useState(initMembers||[]);
  const [requests,   setRequests]   = useState([]);
  const [reports,    setReports]    = useState([]);
  const [invites,    setInvites]    = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [actionMsg,  setActionMsg]  = useState("");
  const [memberQ,    setMemberQ]    = useState("");
  const [selMember,  setSelMember]  = useState(null);   // member detail sheet

  const toast = msg => { setActionMsg(msg); setTimeout(()=>setActionMsg(""),3000); };

  const loadTab = useCallback(async t => {
    setLoading(true);
    if (t === "Requests") {
      const {data} = await supabase.from("group_join_requests")
        .select("*").eq("org_id",orgId).order("created_at",{ascending:false});
      setRequests(data||[]);
    } else if (t === "Reports") {
      const {data} = await supabase.from("group_reports")
        .select("*").eq("org_id",orgId).order("created_at",{ascending:false}).limit(50);
      setReports(data||[]);
    } else if (t === "Invites") {
      const {data} = await supabase.from("group_invites")
        .select("*").eq("org_id",orgId).order("created_at",{ascending:false});
      setInvites(data||[]);
    } else if (t === "Members") {
      const {data} = await supabase.from("org_members")
        .select("*").eq("org_id",orgId).order("reputation_points",{ascending:false});
      setMembers(data||[]);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const approveRequest = async req => {
    // Insert new member
    await supabase.from("org_members").insert({
      org_id: orgId, full_name: req.full_name, email: req.email,
      phone: req.phone, user_id: req.user_id, membership_id: `M-${Date.now()}`,
    });
    await supabase.from("group_join_requests")
      .update({status:"approved",reviewed_by:myId,reviewed_at:new Date().toISOString()})
      .eq("id",req.id);
    setRequests(r=>r.map(x=>x.id===req.id?{...x,status:"approved"}:x));
    toast("✅ Request approved");
  };

  const rejectRequest = async req => {
    await supabase.from("group_join_requests")
      .update({status:"rejected",reviewed_by:myId,reviewed_at:new Date().toISOString()})
      .eq("id",req.id);
    setRequests(r=>r.map(x=>x.id===req.id?{...x,status:"rejected"}:x));
    toast("Request rejected");
  };

  const muteMember = async (mem, minutes=60) => {
    const until = new Date(Date.now()+minutes*60000).toISOString();
    await supabase.from("org_members").update({is_muted:true,muted_until:until}).eq("id",mem.id);
    await supabase.from("group_mutes").upsert({org_id:orgId,member_id:mem.id,muted_by:myId,muted_until:until},{onConflict:"org_id,member_id"});
    setMembers(ms=>ms.map(m=>m.id===mem.id?{...m,is_muted:true,muted_until:until}:m));
    toast(`🔇 ${mem.full_name} muted for ${minutes}m`);
    setSelMember(null);
  };

  const unMuteMember = async mem => {
    await supabase.from("org_members").update({is_muted:false,muted_until:null}).eq("id",mem.id);
    await supabase.from("group_mutes").delete().match({org_id:orgId,member_id:mem.id});
    setMembers(ms=>ms.map(m=>m.id===mem.id?{...m,is_muted:false,muted_until:null}:m));
    toast(`🔊 ${mem.full_name} unmuted`);
    setSelMember(null);
  };

  const banMember = async mem => {
    if (!window.confirm(`Ban ${mem.full_name}? This will suspend their membership.`)) return;
    await supabase.from("org_members").update({is_banned:true,banned_at:new Date().toISOString(),status:"suspended"}).eq("id",mem.id);
    await supabase.from("group_bans").insert({org_id:orgId,member_id:mem.id,banned_by:myId,banned_user_id:mem.user_id,is_permanent:false});
    setMembers(ms=>ms.map(m=>m.id===mem.id?{...m,is_banned:true,status:"suspended"}:m));
    toast(`⛔ ${mem.full_name} banned`);
    setSelMember(null);
  };

  const setChatRole = async (mem, role) => {
    await supabase.from("org_members").update({chat_role:role}).eq("id",mem.id);
    setMembers(ms=>ms.map(m=>m.id===mem.id?{...m,chat_role:role}:m));
    toast(`${mem.full_name} is now ${role}`);
    setSelMember(null);
  };

  const resolveReport = async (rep, action) => {
    await supabase.from("group_reports")
      .update({status:"resolved",reviewed_by:myId,reviewed_at:new Date().toISOString(),action_taken:action})
      .eq("id",rep.id);
    setReports(rs=>rs.map(r=>r.id===rep.id?{...r,status:"resolved",action_taken:action}:r));
    toast("Report resolved");
  };

  const deactivateInvite = async inv => {
    await supabase.from("group_invites").update({is_active:false}).eq("id",inv.id);
    setInvites(is=>is.map(i=>i.id===inv.id?{...i,is_active:false}:i));
    toast("Invite deactivated");
  };

  const createInvite = async () => {
    const {data,error} = await supabase.from("group_invites")
      .insert({org_id:orgId,created_by:myId,label:"General Invite"})
      .select().single();
    if (!error) setInvites(is=>[data,...is]);
    toast("✅ New invite link created");
  };

  const filtMembers = memberQ.trim()
    ? members.filter(m=>m.full_name?.toLowerCase().includes(memberQ.toLowerCase()))
    : members;

  const ROLE_OPTIONS = ["member","verified","premium","moderator","admin"];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[125] flex flex-col bg-[#f0f2f5]">

      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-2"
        style={{background:"#075E54",paddingTop:"max(10px,env(safe-area-inset-top))",paddingBottom:"10px"}}>
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10 flex-shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-5 h-5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <span className="flex-1 text-[17px] font-bold text-white">Admin Dashboard</span>
        <div className="flex items-center gap-1">
          {pendingReqs>0&&<span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{pendingReqs} req</span>}
          {pendingReps>0&&<span className="bg-orange-400 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{pendingReps} rep</span>}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 bg-[#075E54] border-t border-white/10">
        <div className="flex overflow-x-auto">
          {TABS.map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              className={`px-4 py-2.5 text-[12px] font-bold flex-shrink-0 border-b-2 transition-colors
                ${tab===t?"border-white text-white":"border-transparent text-white/60"}`}>
              {t}
              {t==="Requests"&&pendingReqs>0&&<span className="ml-1 bg-red-500 text-white text-[8px] font-bold px-1 rounded-full">{pendingReqs}</span>}
              {t==="Reports"&&pendingReps>0&&<span className="ml-1 bg-orange-400 text-white text-[8px] font-bold px-1 rounded-full">{pendingReps}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Toast */}
      {actionMsg && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[200] bg-slate-800 text-white text-sm font-medium px-4 py-2.5 rounded-2xl shadow-xl">
          {actionMsg}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">

        {/* ── OVERVIEW ── */}
        {tab==="Overview" && analytics && (
          <div className="p-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon="👥" label="Members"     value={analytics.total_members}    sub={`+${analytics.new_members_30d} this month`}/>
              <StatCard icon="🔴" label="Online Now"  value={onlineIds.length}/>
              <StatCard icon="💬" label="Messages 7d" value={analytics.messages_last_7d} sub={`${analytics.messages_last_30d} this month`}/>
              <StatCard icon="🧑‍💻" label="Active 7d"  value={analytics.active_members_7d}/>
              <StatCard icon="⚠️"  label="Pending"    value={(analytics.reports_pending||0)+(analytics.join_requests||0)} sub="reports + requests"/>
              <StatCard icon="📁" label="Media"       value={analytics.media_shared}/>
            </div>

            {/* Top contributors */}
            {analytics.top_contributors?.length>0 && (
              <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
                <SectionHeader title="Top Contributors"/>
                {analytics.top_contributors.map((m,i)=>(
                  <div key={m.member_id} className={`flex items-center gap-3 px-4 py-3 ${i<analytics.top_contributors.length-1?"border-b border-slate-50":""}`}>
                    <span className="w-6 text-center text-[12px] font-extrabold" style={{color:BADGE_COLORS[i]||"#94a3b8"}}>#{i+1}</span>
                    <Av name={m.full_name} size={38} url={m.avatar_url}/>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-slate-800 truncate">{m.full_name}</p>
                      <p className="text-[11px] text-slate-400">{m.reputation_points} pts · Lv{m.level}</p>
                    </div>
                    {i===0&&<span className="text-lg">🥇</span>}
                    {i===1&&<span className="text-lg">🥈</span>}
                    {i===2&&<span className="text-lg">🥉</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Daily messages mini chart */}
            {analytics.daily_messages?.length>0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <p className="text-[12px] font-extrabold text-slate-400 uppercase tracking-wider mb-3">Messages — Last 30 days</p>
                <div className="flex items-end gap-[3px] h-20">
                  {analytics.daily_messages.slice(-30).map((d,i)=>{
                    const max = Math.max(...analytics.daily_messages.map(x=>x.count),1);
                    const h = Math.max((d.count/max)*100,4);
                    return(
                      <div key={i} className="flex-1 rounded-t-sm" style={{height:`${h}%`,background:"#25d366",opacity:0.7+0.3*(d.count/max)}}/>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── MEMBERS ── */}
        {tab==="Members" && (
          <div>
            <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-4 py-2.5">
              <div className="flex items-center gap-2 bg-slate-100 rounded-xl px-3 py-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2} strokeLinecap="round" className="w-4 h-4 flex-shrink-0"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                <input value={memberQ} onChange={e=>setMemberQ(e.target.value)} placeholder="Search members…"
                  className="flex-1 text-sm bg-transparent outline-none text-slate-800 placeholder-slate-400"/>
              </div>
            </div>
            {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#128c7e] border-t-transparent rounded-full animate-spin"/></div>
            : filtMembers.map((m,i)=>(
              <div key={m.id} className={`flex items-center gap-3 px-4 py-3.5 bg-white ${i>0?"border-t border-slate-50":""}`}>
                <Av name={m.full_name} size={44} url={m.avatar_url||m.profile_image_url}/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-[14px] font-semibold text-slate-900 truncate">{m.full_name}</p>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{background:({owner:"#fef3c7",admin:"#ede9fe",moderator:"#dbeafe",verified:"#d1fae5",premium:"#fce7f3",member:"#f1f5f9"})[m.chat_role||"member"],
                              color:     ({owner:"#92400e",admin:"#6d28d9",moderator:"#1d4ed8",verified:"#065f46",premium:"#9d174d",member:"#475569"})[m.chat_role||"member"]}}>
                      {(m.chat_role||"member").charAt(0).toUpperCase()+(m.chat_role||"member").slice(1)}
                    </span>
                    {m.is_muted&&<span className="text-[9px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">Muted</span>}
                    {m.is_banned&&<span className="text-[9px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">Banned</span>}
                  </div>
                  <p className="text-[11px] text-slate-400">{m.message_count} msgs · {m.reputation_points} pts</p>
                </div>
                <button onClick={()=>setSelMember(m)}
                  className="w-8 h-8 flex items-center justify-center rounded-full active:bg-slate-100 text-slate-400">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── REQUESTS ── */}
        {tab==="Requests" && (
          <div>
            {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#128c7e] border-t-transparent rounded-full animate-spin"/></div>
            : requests.length===0 ? <div className="flex flex-col items-center py-16 text-slate-400 gap-2"><span className="text-4xl">✅</span><p className="text-sm">No join requests</p></div>
            : requests.map((r,i)=>(
              <div key={r.id} className={`bg-white px-4 py-4 ${i>0?"border-t border-slate-50":""}`}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-600 text-sm flex-shrink-0">
                    {r.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-slate-800">{r.full_name}</p>
                    <p className="text-[11px] text-slate-400">{r.email} · {fmtDate(r.created_at)}</p>
                    {r.message && <p className="text-[12px] text-slate-600 mt-1 italic">"{r.message}"</p>}
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.status==="pending"?"bg-amber-100 text-amber-700":r.status==="approved"?"bg-green-100 text-green-700":"bg-red-100 text-red-600"}`}>
                        {r.status.charAt(0).toUpperCase()+r.status.slice(1)}
                      </span>
                    </div>
                  </div>
                </div>
                {r.status==="pending" && (
                  <div className="flex gap-2 mt-3">
                    <button onClick={()=>rejectRequest(r)}
                      className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold active:bg-slate-50">
                      Reject
                    </button>
                    <button onClick={()=>approveRequest(r)}
                      className="flex-1 py-2.5 bg-[#128c7e] text-white rounded-xl text-sm font-bold active:opacity-80">
                      Approve
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── REPORTS ── */}
        {tab==="Reports" && (
          <div>
            {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#128c7e] border-t-transparent rounded-full animate-spin"/></div>
            : reports.length===0 ? <div className="flex flex-col items-center py-16 text-slate-400 gap-2"><span className="text-4xl">🛡️</span><p className="text-sm">No reports</p></div>
            : reports.map((r,i)=>(
              <div key={r.id} className={`bg-white px-4 py-4 ${i>0?"border-t border-slate-50":""}`}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-lg flex-shrink-0">⚠️</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] font-bold text-slate-800">{r.category.replace(/_/g," ")}</p>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${r.status==="pending"?"bg-amber-100 text-amber-700":"bg-green-100 text-green-700"}`}>{r.status}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">by {r.reporter_name} · {fmtDate(r.created_at)}</p>
                    {r.description && <p className="text-[12px] text-slate-600 mt-1">"{r.description}"</p>}
                    {r.status==="pending" && (
                      <div className="flex gap-2 mt-2.5 flex-wrap">
                        {["no_action","warned","muted","message_deleted"].map(a=>(
                          <button key={a} onClick={()=>resolveReport(r,a)}
                            className="text-[11px] font-bold px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 active:bg-slate-50">
                            {a.replace(/_/g," ")}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── INVITES ── */}
        {tab==="Invites" && (
          <div>
            <div className="bg-white border-b border-slate-100 px-4 py-3 flex justify-end">
              <button onClick={createInvite}
                className="bg-[#128c7e] text-white text-sm font-bold px-4 py-2 rounded-xl active:opacity-80">
                + New Link
              </button>
            </div>
            {loading ? <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#128c7e] border-t-transparent rounded-full animate-spin"/></div>
            : invites.map((inv,i)=>(
              <div key={inv.id} className={`bg-white px-4 py-4 ${i>0?"border-t border-slate-50":""}`}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-bold text-slate-800 font-mono">{inv.code}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {inv.use_count} uses{inv.max_uses?` / ${inv.max_uses}`:""}
                      {inv.expires_at?` · expires ${fmtDate(inv.expires_at)}`:" · no expiry"}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${inv.is_active?"bg-green-100 text-green-700":"bg-slate-100 text-slate-500"}`}>
                    {inv.is_active?"Active":"Inactive"}
                  </span>
                  {inv.is_active && (
                    <button onClick={()=>navigator.clipboard?.writeText(`https://kudiai.app/join/${inv.code}`)}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 active:bg-slate-200 text-slate-600 text-xs font-bold">
                      📋
                    </button>
                  )}
                  {inv.is_active && (
                    <button onClick={()=>deactivateInvite(inv)}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-red-50 active:bg-red-100 text-red-500 text-xs">
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── SETTINGS ── */}
        {tab==="Settings" && (
          <div className="p-4 flex flex-col gap-3">
            <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
              <button onClick={()=>onNavigate&&onNavigate("privacy")}
                className="w-full flex items-center gap-4 px-5 py-4 border-b border-slate-50 active:bg-slate-50">
                <span className="text-xl">🔒</span>
                <div className="flex-1 text-left"><p className="text-[14px] font-semibold text-slate-800">Privacy & Chat Lock</p><p className="text-[11px] text-slate-400">Disappearing messages, slow mode</p></div>
                <svg viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth={2} strokeLinecap="round" className="w-4 h-4"><path d="M9 18l6-6-6-6"/></svg>
              </button>
              <button onClick={()=>onNavigate&&onNavigate("invites")}
                className="w-full flex items-center gap-4 px-5 py-4 active:bg-slate-50">
                <span className="text-xl">🔗</span>
                <div className="flex-1 text-left"><p className="text-[14px] font-semibold text-slate-800">Invite Links</p><p className="text-[11px] text-slate-400">Manage invite links & QR codes</p></div>
                <svg viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth={2} strokeLinecap="round" className="w-4 h-4"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
          </div>
        )}

        <div className="h-10"/>
      </div>

      {/* ── Member action sheet ── */}
      {selMember && (
        <div className="fixed inset-0 z-[140] flex items-end justify-center" onClick={()=>setSelMember(null)}>
          <div className="absolute inset-0 bg-black/50"/>
          <div className="relative w-full max-w-md bg-white rounded-t-3xl overflow-hidden" onClick={e=>e.stopPropagation()}>
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-2"/>
            <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
              <Av name={selMember.full_name} size={44} url={selMember.avatar_url||selMember.profile_image_url}/>
              <div>
                <p className="text-[15px] font-bold text-slate-800">{selMember.full_name}</p>
                <p className="text-[12px] text-slate-400">{selMember.reputation_points} pts · Lv{selMember.level||1}</p>
              </div>
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-2">Change Role</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {ROLE_OPTIONS.map(r=>(
                  <button key={r} onClick={()=>setChatRole(selMember,r)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${selMember.chat_role===r?"bg-[#128c7e] text-white":"bg-slate-100 text-slate-600 active:bg-slate-200"}`}>
                    {r.charAt(0).toUpperCase()+r.slice(1)}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                {selMember.is_muted
                  ? <button onClick={()=>unMuteMember(selMember)} className="w-full py-3 bg-green-50 text-green-700 font-bold rounded-xl text-sm active:bg-green-100">🔊 Unmute Member</button>
                  : <>
                    <button onClick={()=>muteMember(selMember,60)} className="w-full py-3 bg-amber-50 text-amber-700 font-bold rounded-xl text-sm active:bg-amber-100">🔇 Mute 1 hour</button>
                    <button onClick={()=>muteMember(selMember,1440)} className="w-full py-3 bg-amber-50 text-amber-700 font-bold rounded-xl text-sm active:bg-amber-100">🔇 Mute 24 hours</button>
                  </>
                }
                {!selMember.is_banned && (
                  <button onClick={()=>banMember(selMember)} className="w-full py-3 bg-red-50 text-red-600 font-bold rounded-xl text-sm active:bg-red-100">⛔ Ban Member</button>
                )}
              </div>
            </div>
            <div className="px-4 pb-6">
              <button onClick={()=>setSelMember(null)} className="w-full py-3 bg-slate-100 text-slate-600 font-bold rounded-xl text-sm active:bg-slate-200">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
