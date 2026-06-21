import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../../utils/supabase";

const ROLE_STYLE = {
  host:      { bg:"#fef3c7", text:"#92400e",  label:"Host"     },
  co_host:   { bg:"#ede9fe", text:"#6d28d9",  label:"Co-host"  },
  speaker:   { bg:"#dbeafe", text:"#1d4ed8",  label:"Speaker"  },
  listener:  { bg:"#f1f5f9", text:"#475569",  label:"Listener" },
};

function Av({ name, avatarUrl, size=44, muted, speaking }) {
  return (
    <div className="relative flex-shrink-0" style={{width:size,height:size}}>
      <div className={`rounded-full overflow-hidden bg-[#128c7e] flex items-center justify-center text-white font-bold transition-all
        ${speaking?"ring-2 ring-[#25d366] ring-offset-2":""}
      `} style={{width:size,height:size,fontSize:size*0.38}}>
        {avatarUrl
          ? <img src={avatarUrl} alt="" className="w-full h-full object-cover"/>
          : (name||"?")[0].toUpperCase()}
      </div>
      {muted && (
        <div className="absolute bottom-0 right-0 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="white" className="w-2.5 h-2.5"><path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M9.09 4.91a5 5 0 015.82 0M15 9a3 3 0 11-6 0V5a3 3 0 016 0v4z"/></svg>
        </div>
      )}
    </div>
  );
}

function ParticipantCard({ p, myRole, myId, roomId, onRoleChange }) {
  const canPromote = (myRole==="host"||myRole==="co_host") && p.user_id!==myId;

  const promote = async () => {
    const next = p.role==="listener"?"speaker":"listener";
    await supabase.from("group_voice_participants").update({role:next}).match({room_id:roomId,user_id:p.user_id});
    onRoleChange(p.user_id, next);
  };

  const rs = ROLE_STYLE[p.role]||ROLE_STYLE.listener;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Av name={p.display_name} avatarUrl={p.avatar_url} size={46} muted={p.is_muted} speaking={p.is_speaking}/>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-slate-800 truncate">{p.display_name}</p>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{background:rs.bg,color:rs.text}}>{rs.label}</span>
      </div>
      {canPromote && (
        <button onClick={promote} className="text-[11px] font-bold text-[#128c7e] bg-[#128c7e]/10 px-2.5 py-1 rounded-xl active:bg-[#128c7e]/20">
          {p.role==="listener"?"Invite to speak":"Move to listener"}
        </button>
      )}
    </div>
  );
}

export default function VoiceRoom({ orgId, myId, myName, avatarUrl: myAvatar, isAdmin, onBack }) {
  const [rooms,     setRooms]     = useState([]);
  const [activeRoom,setActiveRoom]= useState(null);
  const [parts,     setParts]     = useState([]);
  const [myRole,    setMyRole]    = useState("listener");
  const [muted,     setMuted]     = useState(true);
  const [creating,  setCreating]  = useState(false);
  const [newTitle,  setNewTitle]  = useState("");
  const [loading,   setLoading]   = useState(true);

  const streamRef      = useRef(null);
  const channelRef     = useRef(null);
  const analyserRef    = useRef(null);
  const speakTimerRef  = useRef(null);

  const loadRooms = useCallback(async()=>{
    const {data}=await supabase.from("group_voice_rooms").select("*").eq("org_id",orgId).eq("status","active").order("created_at",{ascending:false});
    setRooms(data||[]);
    setLoading(false);
  },[orgId]);

  useEffect(()=>{ loadRooms(); },[loadRooms]);

  const createRoom = async () => {
    if(!newTitle.trim()) return;
    const {data:room}=await supabase.from("group_voice_rooms").insert({
      org_id:orgId, created_by:myId, name:newTitle.trim(), status:"active",
      channel_id:`voice-${orgId}-${Date.now()}`,
    }).select().single();
    if(room){ setCreating(false); setNewTitle(""); joinRoom(room,"host"); }
  };

  const joinRoom = useCallback(async (room, roleOverride="listener")=>{
    const {data:existing}=await supabase.from("group_voice_participants").select("role")
      .match({room_id:room.id,user_id:myId}).single();
    const role = roleOverride||(existing?.role||"listener");

    if(!existing){
      await supabase.from("group_voice_participants").insert({
        room_id:room.id, org_id:orgId, user_id:myId,
        display_name:myName, avatar_url:myAvatar||null, role, is_muted:true,
      });
    }

    const {data:ps}=await supabase.from("group_voice_participants").select("*").eq("room_id",room.id);
    setParts(ps||[]);
    setMyRole(role);
    setActiveRoom(room);

    const ch = supabase.channel(room.channel_id, {config:{broadcast:{self:true}}});
    channelRef.current = ch;

    ch.on("broadcast",{event:"participant-update"},({payload})=>{
      setParts(prev=>prev.map(p=>p.user_id===payload.user_id?{...p,...payload}:p));
    }).on("broadcast",{event:"participant-join"},({payload})=>{
      setParts(prev=>[...prev.filter(p=>p.user_id!==payload.user_id),payload]);
    }).on("broadcast",{event:"participant-leave"},({payload})=>{
      setParts(prev=>prev.filter(p=>p.user_id!==payload.user_id));
    }).subscribe(status=>{
      if(status==="SUBSCRIBED"){
        ch.send({type:"broadcast",event:"participant-join",payload:{user_id:myId,display_name:myName,avatar_url:myAvatar,role,is_muted:true,is_speaking:false}});
      }
    });
  },[orgId,myId,myName,myAvatar]);

  const toggleMic = async () => {
    if(myRole==="listener") return;
    if(!streamRef.current){
      try {
        streamRef.current = await navigator.mediaDevices.getUserMedia({audio:true,video:false});
        setupVoiceDetection(streamRef.current);
      } catch { return; }
    }
    const newMuted = !muted;
    streamRef.current.getAudioTracks().forEach(t=>{ t.enabled=!newMuted; });
    setMuted(newMuted);
    await supabase.from("group_voice_participants").update({is_muted:newMuted}).match({room_id:activeRoom.id,user_id:myId});
    channelRef.current?.send({type:"broadcast",event:"participant-update",payload:{user_id:myId,is_muted:newMuted}});
  };

  const setupVoiceDetection = stream => {
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize=256;
    src.connect(analyser);
    analyserRef.current = analyser;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const check = ()=>{
      analyser.getByteFrequencyData(buf);
      const vol = buf.reduce((a,b)=>a+b,0)/buf.length;
      const spk = vol>20;
      channelRef.current?.send({type:"broadcast",event:"participant-update",payload:{user_id:myId,is_speaking:spk}});
      speakTimerRef.current = setTimeout(check,200);
    };
    check();
  };

  const leaveRoom = async () => {
    clearTimeout(speakTimerRef.current);
    streamRef.current?.getTracks().forEach(t=>t.stop());
    streamRef.current=null;
    channelRef.current?.send({type:"broadcast",event:"participant-leave",payload:{user_id:myId}});
    await supabase.removeChannel(channelRef.current);
    channelRef.current=null;
    await supabase.from("group_voice_participants").delete().match({room_id:activeRoom.id,user_id:myId});
    const remaining = parts.filter(p=>p.user_id!==myId);
    if(remaining.length===0) await supabase.from("group_voice_rooms").update({status:"ended",ended_at:new Date().toISOString()}).eq("id",activeRoom.id);
    setActiveRoom(null);
    setParts([]);
    setMuted(true);
    loadRooms();
  };

  const handleRoleChange = (uid,role)=>{ setParts(ps=>ps.map(p=>p.user_id===uid?{...p,role}:p)); if(uid===myId)setMyRole(role); };

  if(activeRoom) {
    const speakers  = parts.filter(p=>p.role==="host"||p.role==="co_host"||p.role==="speaker");
    const listeners = parts.filter(p=>p.role==="listener");

    return (
      <div className="fixed inset-0 z-[125] flex flex-col bg-[#f0f2f5]">
        <div className="flex-shrink-0 flex items-center gap-2 px-2"
          style={{background:"#075E54",paddingTop:"max(10px,env(safe-area-inset-top))",paddingBottom:"10px"}}>
          <div className="flex-1 min-w-0 pl-1">
            <p className="text-white font-bold text-[16px] truncate">{activeRoom.name}</p>
            <p className="text-white/70 text-[11px]">{parts.length} participant{parts.length!==1?"s":""}</p>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-[#25d366] animate-pulse"/>
            <span className="text-white/80 text-[11px] font-bold">LIVE</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-4 pt-4 pb-2">
            <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider mb-2">On stage · {speakers.length}</p>
            <div className="grid grid-cols-4 gap-3">
              {speakers.map(p=>(
                <button key={p.user_id} className="flex flex-col items-center gap-1.5 active:opacity-70">
                  <Av name={p.display_name} avatarUrl={p.avatar_url} size={60} muted={p.is_muted} speaking={p.is_speaking}/>
                  <p className="text-[10px] text-slate-600 font-medium truncate w-full text-center">{p.display_name?.split(" ")[0]}</p>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{background:ROLE_STYLE[p.role]?.bg,color:ROLE_STYLE[p.role]?.text}}>{ROLE_STYLE[p.role]?.label}</span>
                </button>
              ))}
            </div>
          </div>

          {listeners.length>0 && (
            <div className="px-4 pt-3 pb-2">
              <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider mb-2">Listening · {listeners.length}</p>
              <div className="bg-white rounded-2xl overflow-hidden">
                {listeners.map(p=>(
                  <ParticipantCard key={p.user_id} p={p} myRole={myRole} myId={myId} roomId={activeRoom.id} onRoleChange={handleRoleChange}/>
                ))}
              </div>
            </div>
          )}
          <div className="h-28"/>
        </div>

        <div className="flex-shrink-0 bg-white border-t border-slate-100 px-4 flex items-center justify-between gap-3"
          style={{paddingBottom:"max(16px,env(safe-area-inset-bottom))",paddingTop:"12px"}}>
          {myRole==="listener"
            ? <div className="flex-1 flex flex-col items-center">
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2} className="w-5 h-5"><path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 1v10"/></svg>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Listening</p>
              </div>
            : <div className="flex-1 flex flex-col items-center">
                <button onClick={toggleMic}
                  className={`w-14 h-14 rounded-full flex items-center justify-center shadow-md active:scale-95 transition-transform
                    ${muted?"bg-red-500":"bg-[#128c7e]"}`}>
                  {muted
                    ? <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6"><path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m0-13a3 3 0 00-6 0v4a3 3 0 006 0V5z"/><line x1="1" y1="1" x2="23" y2="23" stroke="white" strokeWidth="2"/></svg>
                    : <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6"><path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 1v10"/><rect x="9" y="1" width="6" height="10" rx="3" fill="white"/></svg>}
                </button>
                <p className="text-[10px] text-slate-500 mt-1">{muted?"Unmute":"Mute"}</p>
              </div>}

          <button onClick={leaveRoom}
            className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center shadow-md active:scale-95 transition-transform">
            <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6"><path d="M16.5 9.4l-9-5.2M21 16.92v3.078a2 2 0 01-2.18 1.993 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 013.12 2h3.08a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L7.91 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>
          </button>
          <p className="text-[10px] text-red-500 font-bold">Leave</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[125] flex flex-col bg-[#f0f2f5]">
      <div className="flex-shrink-0 flex items-center gap-2 px-2"
        style={{background:"#075E54",paddingTop:"max(10px,env(safe-area-inset-top))",paddingBottom:"10px"}}>
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full active:bg-white/10 flex-shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-5 h-5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <span className="flex-1 text-[17px] font-bold text-white">Voice Rooms</span>
        {isAdmin && (
          <button onClick={()=>setCreating(true)} className="text-[13px] font-bold text-white bg-white/20 px-3 py-1.5 rounded-xl active:bg-white/30">+ Room</button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-3">
        {loading
          ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#128c7e] border-t-transparent rounded-full animate-spin"/></div>
          : rooms.length===0
          ? <div className="flex flex-col items-center py-16 text-slate-400 gap-2">
              <span className="text-5xl">🎙️</span>
              <p className="text-sm">No active voice rooms</p>
              {isAdmin&&<button onClick={()=>setCreating(true)} className="mt-2 px-4 py-2 bg-[#128c7e] text-white text-sm font-bold rounded-xl active:opacity-80">Start a room</button>}
            </div>
          : rooms.map(r=>(
              <button key={r.id} onClick={()=>joinRoom(r)}
                className="w-full mx-0 bg-white px-4 py-4 border-b border-slate-50 flex items-center gap-3 active:bg-slate-50">
                <div className="w-12 h-12 rounded-2xl bg-[#128c7e]/10 flex items-center justify-center flex-shrink-0">
                  <svg viewBox="0 0 24 24" fill="#128c7e" className="w-6 h-6"><path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4M12 1v10M9 1h6v10H9z"/></svg>
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-[15px] font-bold text-slate-800">{r.name}</p>
                  <p className="text-[12px] text-slate-400">{r.speaker_count||0} speaker{r.speaker_count!==1?"s":""} · {r.listener_count||0} listening</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <div className="w-2 h-2 rounded-full bg-[#25d366] animate-pulse"/>
                  <span className="text-[11px] font-bold text-[#128c7e]">LIVE</span>
                </div>
              </button>
            ))}
      </div>

      {creating && (
        <div className="fixed inset-0 z-[140] flex items-end justify-center" onClick={()=>setCreating(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"/>
          <div className="relative w-full max-w-md bg-white rounded-t-3xl px-5 pt-3 pb-6 flex flex-col gap-4" onClick={e=>e.stopPropagation()}>
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-1"/>
            <h3 className="text-base font-extrabold text-slate-800">Start a Voice Room</h3>
            <input value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="Room title…"
              className="bg-slate-100 rounded-xl px-3.5 py-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-[#128c7e]"
              autoFocus onKeyDown={e=>e.key==="Enter"&&createRoom()}/>
            <div className="flex gap-2">
              <button onClick={()=>setCreating(false)} className="flex-1 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold text-sm">Cancel</button>
              <button onClick={createRoom} disabled={!newTitle.trim()}
                className="flex-1 py-3 bg-[#128c7e] text-white rounded-xl font-bold text-sm disabled:opacity-50 active:opacity-80">Start</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
