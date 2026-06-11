// Advanced Business Relationship Management (BRM) + CRM System
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../utils/supabase";

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt      = n  => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 0 });
const fmtK     = n  => n >= 1_000_000 ? `₦${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `₦${(n/1_000).toFixed(0)}K` : fmt(n);
const fmtDate  = d  => d ? new Date(d).toLocaleDateString("en-NG", { day:"numeric", month:"short", year:"numeric" }) : "—";
const daysSince = d => d ? Math.floor((Date.now() - new Date(d)) / 86400000) : 9999;

// ── Health score calculation ──────────────────────────────────────────────────
function computeHealth(client) {
  const days = daysSince(client.last_interaction_date);
  const act  = days < 30 ? 100 : days < 60 ? 80 : days < 90 ? 60 : days < 180 ? 35 : 15;
  const rel  = { client:100, partner:80, prospect:60, lead:40, inactive:10 }[client.relationship_type] ?? 50;
  const score = Math.round(act * 0.6 + rel * 0.4);
  const risk  = score >= 75 ? "low" : score >= 55 ? "medium" : score >= 35 ? "high" : "critical";
  return { score, risk };
}

// ── Constants ─────────────────────────────────────────────────────────────────
const STAGES = [
  { id:"new",         label:"New",         color:"bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
  { id:"contacted",   label:"Contacted",   color:"bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  { id:"qualified",   label:"Qualified",   color:"bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" },
  { id:"proposal",    label:"Proposal",    color:"bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  { id:"negotiation", label:"Negotiation", color:"bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  { id:"won",         label:"Won ✓",       color:"bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  { id:"lost",        label:"Lost",        color:"bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
];

const INDUSTRIES = ["Agriculture","Construction","Education","Finance","Food & Beverage","Healthcare",
  "IT & Technology","Logistics","Manufacturing","Media","NGO / Non-Profit","Real Estate","Retail",
  "Telecoms","Trading","Transport","Other"];

const SOURCES = [
  { value:"direct",      label:"Direct / Walk-in" },
  { value:"referral",    label:"Referral" },
  { value:"cold_call",   label:"Cold Call" },
  { value:"social_media",label:"Social Media" },
  { value:"event",       label:"Event / Exhibition" },
  { value:"website",     label:"Website" },
  { value:"other",       label:"Other" },
];

const NOTE_ICONS = { note:"📝", meeting:"🤝", call:"📞", visit:"🚗", email:"✉️", follow_up:"🔔", complaint:"⚠️" };
const EVENT_ICONS = { registration:"🎉", update:"✏️", marketer_change:"👤", note:"📝", meeting:"🤝",
  call:"📞", visit:"🚗", email:"✉️", follow_up:"🔔", complaint:"⚠️", payment:"💰" };

const RISK_COLOR = { low:"text-green-600 bg-green-50 dark:bg-green-900/30",
  medium:"text-amber-600 bg-amber-50 dark:bg-amber-900/30",
  high:"text-orange-600 bg-orange-50 dark:bg-orange-900/30",
  critical:"text-red-600 bg-red-50 dark:bg-red-900/30" };

// ── Shared UI Components ──────────────────────────────────────────────────────
function Sheet({ onClose, children, title, wide }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50" onClick={onClose}>
      <div className={`bg-white dark:bg-slate-800 rounded-t-3xl w-full ${wide ? "max-w-2xl" : "max-w-lg"} max-h-[92vh] overflow-y-auto`}
        onClick={e => e.stopPropagation()}>
        {title && (
          <div className="sticky top-0 bg-white dark:bg-slate-800 z-10 flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100 dark:border-slate-700">
            <h2 className="font-extrabold text-slate-800 dark:text-white text-base">{title}</h2>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 text-lg font-bold">×</button>
          </div>
        )}
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function Inp({ label, value, onChange, type = "text", placeholder = "", required, disabled }) {
  return (
    <div>
      {label && <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>}
      <input type={type} value={value ?? ""} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50" />
    </div>
  );
}

function Sel({ label, value, onChange, options, required }) {
  return (
    <div>
      {label && <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>}
      <select value={value ?? ""} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
        {options.map(o => typeof o === "string"
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Textarea({ label, value, onChange, placeholder = "", rows = 3, required }) {
  return (
    <div>
      {label && <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>}
      <textarea value={value ?? ""} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} rows={rows}
        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", disabled, small }) {
  const styles = {
    primary: "bg-violet-600 hover:bg-violet-700 text-white",
    secondary: "bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200",
    danger: "bg-red-50 hover:bg-red-100 text-red-600",
    green: "bg-green-600 hover:bg-green-700 text-white",
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`${small ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm"} font-bold rounded-xl disabled:opacity-50 transition-colors ${styles[variant]}`}>
      {children}
    </button>
  );
}

function HealthBadge({ score, risk }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${RISK_COLOR[risk] || RISK_COLOR.low}`}>
      {score}% · {(risk || "low").toUpperCase()}
    </span>
  );
}

function StagePill({ stage }) {
  const s = STAGES.find(x => x.id === stage) ?? STAGES[0];
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.color}`}>{s.label}</span>;
}

function StatCard({ label, value, sub, icon, color = "violet", onClick }) {
  const bg = { violet:"bg-violet-50 dark:bg-violet-900/20 text-violet-600", green:"bg-green-50 dark:bg-green-900/20 text-green-600",
    amber:"bg-amber-50 dark:bg-amber-900/20 text-amber-600", red:"bg-red-50 dark:bg-red-900/20 text-red-600",
    blue:"bg-blue-50 dark:bg-blue-900/20 text-blue-600" };
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 ${onClick ? "cursor-pointer active:scale-95 transition-transform" : ""}`} onClick={onClick}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 text-lg ${bg[color]}`}>{icon}</div>
      <p className="text-xl font-extrabold text-slate-800 dark:text-white leading-tight">{value}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

function EmptyState({ icon, title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-4xl mb-3">{icon}</div>
      <p className="font-bold text-slate-700 dark:text-slate-300">{title}</p>
      <p className="text-sm text-slate-400 mt-1">{sub}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN BRM COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function BRM({ onClose, userId }) {
  const [tab, setTab] = useState("overview");

  // Data
  const [clients,    setClients]    = useState([]);
  const [leads,      setLeads]      = useState([]);
  const [marketers,  setMarketers]  = useState([]);
  const [commRecs,   setCommRecs]   = useState([]);
  const [commRules,  setCommRules]  = useState([]);
  const [notes,      setNotes]      = useState([]);
  const [timeline,   setTimeline]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [err,        setErr]        = useState("");

  // Detail panels
  const [selClient,   setSelClient]   = useState(null);
  const [selLead,     setSelLead]     = useState(null);
  const [selMarketer, setSelMarketer] = useState(null);

  // Forms
  const [form,     setForm]     = useState(null); // "client"|"lead"|"marketer"|"note"|"rule"|"record"
  const [editItem, setEditItem] = useState(null);
  const [fd,       setFd]       = useState({});
  const [saving,   setSaving]   = useState(false);

  // Filters
  const [cFilter,     setCFilter]     = useState("all");
  const [cSearch,     setCSearch]     = useState("");
  const [lStage,      setLStage]      = useState("all");
  const [lSearch,     setLSearch]     = useState("");
  const [markSearch,  setMarkSearch]  = useState("");

  // AI insights
  const [insights,      setInsights]      = useState(null);
  const [loadingInsight,setLoadingInsight] = useState(false);

  // ── Load all data ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true); setErr("");
    try {
      const [c, l, m, cr, rules, n, tl] = await Promise.all([
        supabase.from("brm_clients").select("*, brm_assignments(marketer_id,is_current,brm_marketers(full_name))").eq("owner_id",userId).order("created_at",{ascending:false}),
        supabase.from("crm_leads").select("*, brm_marketers(full_name)").eq("owner_id",userId).order("created_at",{ascending:false}),
        supabase.from("brm_marketers").select("*").eq("owner_id",userId).neq("status","inactive").order("full_name"),
        supabase.from("commission_records").select("*, brm_marketers(full_name), brm_clients(company_name)").eq("owner_id",userId).order("created_at",{ascending:false}),
        supabase.from("commission_rules").select("*").eq("owner_id",userId).order("created_at"),
        supabase.from("brm_notes").select("*").eq("owner_id",userId).order("created_at",{ascending:false}).limit(200),
        supabase.from("brm_timeline").select("*").eq("owner_id",userId).order("created_at",{ascending:false}).limit(100),
      ]);
      const enriched = (c.data||[]).map(cl => {
        const { score, risk } = computeHealth(cl);
        return { ...cl, health_score:score, churn_risk:risk };
      });
      setClients(enriched); setLeads(l.data||[]); setMarketers(m.data||[]);
      setCommRecs(cr.data||[]); setCommRules(rules.data||[]);
      setNotes(n.data||[]); setTimeline(tl.data||[]);
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const set = (k,v) => setFd(p => ({ ...p, [k]:v }));

  // ── Computed stats ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active     = clients.filter(c => c.relationship_type !== "inactive");
    const pipeline   = leads.filter(l => !["won","lost"].includes(l.stage)).reduce((s,l)=>s+(l.deal_value||0),0);
    const pendComm   = commRecs.filter(r=>r.status==="pending").reduce((s,r)=>s+(r.commission_amount||0),0);
    const paidComm   = commRecs.filter(r=>r.status==="paid").reduce((s,r)=>s+(r.commission_amount||0),0);
    const atRisk     = clients.filter(c=>["high","critical"].includes(c.churn_risk)).length;
    const avgHealth  = clients.length ? Math.round(clients.reduce((s,c)=>s+c.health_score,0)/clients.length) : 0;
    const wonLeads   = leads.filter(l=>l.stage==="won").length;
    const totalLeads = leads.filter(l=>l.stage!=="lost").length;
    const winRate    = totalLeads > 0 ? Math.round((wonLeads/totalLeads)*100) : 0;
    return { activeClients:active.length, pipeline, pendComm, paidComm, atRisk, avgHealth, winRate, wonLeads };
  }, [clients, leads, commRecs]);

  // ── Filtered lists ────────────────────────────────────────────────────────
  const filteredClients = useMemo(() => {
    let list = clients;
    if (cFilter==="at-risk") list = list.filter(c=>["high","critical"].includes(c.churn_risk));
    else if (cFilter==="healthy") list = list.filter(c=>c.health_score>=75);
    else if (cFilter==="inactive") list = list.filter(c=>daysSince(c.last_interaction_date)>90);
    if (cSearch) list = list.filter(c=>
      c.company_name.toLowerCase().includes(cSearch.toLowerCase()) ||
      c.contact_name?.toLowerCase().includes(cSearch.toLowerCase()) ||
      c.industry?.toLowerCase().includes(cSearch.toLowerCase()));
    return list;
  }, [clients, cFilter, cSearch]);

  const filteredLeads = useMemo(() => {
    let list = leads;
    if (lStage !== "all") list = list.filter(l=>l.stage===lStage);
    if (lSearch) list = list.filter(l=>l.company_name.toLowerCase().includes(lSearch.toLowerCase()));
    return list;
  }, [leads, lStage, lSearch]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const clientMarketer = c => c.brm_assignments?.find(a=>a.is_current)?.brm_marketers?.full_name ?? null;
  const clientNotes    = id => notes.filter(n=>n.client_id===id);
  const clientTimeline = id => timeline.filter(t=>t.client_id===id);
  const marketerClients = id => clients.filter(c=>c.brm_assignments?.some(a=>a.is_current&&a.marketer_id===id));
  const marketerComm    = id => commRecs.filter(r=>r.marketer_id===id);

  // ── Pending follow-ups ────────────────────────────────────────────────────
  const pendingFollowups = useMemo(() =>
    notes.filter(n=>!n.is_completed && n.follow_up_date && new Date(n.follow_up_date) <= new Date())
  , [notes]);

  // ── Save handlers ─────────────────────────────────────────────────────────
  const saveClient = async () => {
    if (!fd.company_name?.trim()) { setErr("Company name is required"); return; }
    setSaving(true); setErr("");
    try {
      const row = {
        owner_id:fd.company_name ? userId : undefined,
        company_name: fd.company_name.trim(),
        industry: fd.industry||null, business_size: fd.business_size||null,
        employee_count: fd.employee_count ? +fd.employee_count : null,
        annual_revenue: fd.annual_revenue ? +fd.annual_revenue : 0,
        website: fd.website||null, cac_number: fd.cac_number||null,
        kyc_status: fd.kyc_status||"pending",
        contact_name: fd.contact_name||null, contact_email: fd.contact_email||null,
        contact_phone: fd.contact_phone||null, address: fd.address||null,
        state: fd.state||null, relationship_type: fd.relationship_type||"client",
        notes: fd.notes||null,
      };
      if (editItem) {
        await supabase.from("brm_clients").update(row).eq("id",editItem.id);
        await supabase.from("brm_timeline").insert({ owner_id:userId, client_id:editItem.id, event_type:"update", event_title:"Client profile updated" });
      } else {
        const { data:nc, error } = await supabase.from("brm_clients").insert({ ...row, owner_id:userId }).select("id").single();
        if (error) throw error;
        await supabase.from("brm_timeline").insert({ owner_id:userId, client_id:nc.id, event_type:"registration", event_title:"Client added to BRM system" });
        if (fd.marketer_id) await supabase.from("brm_assignments").insert({ owner_id:userId, client_id:nc.id, marketer_id:fd.marketer_id, is_current:true });
      }
      setForm(null); setFd({}); setEditItem(null); await load();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const saveLead = async () => {
    if (!fd.company_name?.trim()) { setErr("Company name is required"); return; }
    setSaving(true); setErr("");
    try {
      const row = {
        owner_id: userId,
        company_name: fd.company_name.trim(), contact_name: fd.contact_name||null,
        contact_email: fd.contact_email||null, contact_phone: fd.contact_phone||null,
        industry: fd.industry||null, source: fd.source||"direct", stage: fd.stage||"new",
        deal_value: fd.deal_value ? +fd.deal_value : 0,
        probability: fd.probability ? +fd.probability : 20,
        expected_close_date: fd.expected_close_date||null,
        marketer_id: fd.marketer_id||null, notes: fd.notes||null,
      };
      if (editItem) { await supabase.from("crm_leads").update(row).eq("id",editItem.id); }
      else { await supabase.from("crm_leads").insert(row); }
      setForm(null); setFd({}); setEditItem(null); await load();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const saveMarketer = async () => {
    if (!fd.full_name?.trim()) { setErr("Name is required"); return; }
    setSaving(true); setErr("");
    try {
      const row = {
        owner_id:userId, full_name:fd.full_name.trim(), email:fd.email||null,
        phone:fd.phone||null, territory:fd.territory||null,
        commission_rate: fd.commission_rate ? +fd.commission_rate : 10.0,
        target_clients: fd.target_clients ? +fd.target_clients : 20, status:"active",
      };
      if (editItem) { await supabase.from("brm_marketers").update(row).eq("id",editItem.id); }
      else { await supabase.from("brm_marketers").insert(row); }
      setForm(null); setFd({}); setEditItem(null); await load();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const saveNote = async () => {
    if (!fd.content?.trim()) { setErr("Note content is required"); return; }
    setSaving(true); setErr("");
    try {
      await supabase.from("brm_notes").insert({
        owner_id:userId, client_id:fd.client_id||null,
        marketer_id:fd.marketer_id||null, note_type:fd.note_type||"note",
        content:fd.content.trim(), follow_up_date:fd.follow_up_date||null, is_completed:false,
      });
      if (fd.client_id) {
        await supabase.from("brm_clients").update({ last_interaction_date:new Date().toISOString() }).eq("id",fd.client_id);
        await supabase.from("brm_timeline").insert({ owner_id:userId, client_id:fd.client_id, event_type:fd.note_type||"note", event_title:fd.content.trim().slice(0,120) });
      }
      setForm(null); setFd({}); await load();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const saveRule = async () => {
    if (!fd.rule_name?.trim() || !fd.rate) { setErr("Rule name and rate are required"); return; }
    setSaving(true); setErr("");
    try {
      const row = { owner_id:userId, rule_name:fd.rule_name.trim(), rule_type:fd.rule_type||"acquisition",
        rate:+fd.rate, min_deal_value:fd.min_deal_value ? +fd.min_deal_value : 0,
        ownership_period_months:fd.ownership_period_months ? +fd.ownership_period_months : 12,
        notes:fd.notes||null, is_active:true };
      if (editItem) { await supabase.from("commission_rules").update(row).eq("id",editItem.id); }
      else { await supabase.from("commission_rules").insert(row); }
      setForm(null); setFd({}); setEditItem(null); await load();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const saveRecord = async () => {
    if (!fd.marketer_id || !fd.deal_value) { setErr("Marketer and deal value are required"); return; }
    setSaving(true); setErr("");
    try {
      const dv = +fd.deal_value;
      const rate = +(fd.rate || marketers.find(m=>m.id===fd.marketer_id)?.commission_rate || 10);
      const amt = Math.round(dv * (rate/100));
      await supabase.from("commission_records").insert({
        owner_id:userId, marketer_id:fd.marketer_id, client_id:fd.client_id||null,
        commission_type:fd.commission_type||"acquisition", deal_value:dv, rate, commission_amount:amt,
        status:"pending", notes:fd.notes||null,
      });
      setForm(null); setFd({}); await load();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const convertLead = async (lead) => {
    if (!window.confirm(`Convert "${lead.company_name}" from lead to client?`)) return;
    setSaving(true);
    try {
      const { data:nc } = await supabase.from("brm_clients").insert({
        owner_id:userId, company_name:lead.company_name, industry:lead.industry,
        contact_name:lead.contact_name, contact_email:lead.contact_email,
        contact_phone:lead.contact_phone, relationship_type:"client",
        acquisition_date:new Date().toISOString().split("T")[0],
        last_interaction_date:new Date().toISOString(),
      }).select("id").single();
      await supabase.from("crm_leads").update({ stage:"won", converted_client_id:nc.id }).eq("id",lead.id);
      if (lead.marketer_id) {
        await supabase.from("brm_assignments").insert({ owner_id:userId, client_id:nc.id, marketer_id:lead.marketer_id, is_current:true });
        const mktr = marketers.find(m=>m.id===lead.marketer_id);
        if (mktr && lead.deal_value > 0) {
          const rate = mktr.commission_rate || 10;
          await supabase.from("commission_records").insert({ owner_id:userId, marketer_id:lead.marketer_id,
            client_id:nc.id, lead_id:lead.id, commission_type:"acquisition", deal_value:lead.deal_value,
            rate, commission_amount:Math.round(lead.deal_value*(rate/100)), status:"pending" });
        }
      }
      await supabase.from("brm_timeline").insert({ owner_id:userId, client_id:nc.id, event_type:"registration", event_title:`Converted from pipeline: ${lead.company_name}` });
      setSelLead(null); await load();
    } catch(e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const updateCommStatus = async (id, status) => {
    await supabase.from("commission_records").update({ status, payout_date:status==="paid"?new Date().toISOString().split("T")[0]:null }).eq("id",id);
    await load();
  };

  const assignMarketer = async (clientId, marketerId) => {
    await supabase.from("brm_assignments").update({ is_current:false, released_at:new Date().toISOString() }).eq("client_id",clientId).eq("is_current",true);
    if (marketerId) await supabase.from("brm_assignments").insert({ owner_id:userId, client_id:clientId, marketer_id:marketerId, is_current:true });
    await supabase.from("brm_timeline").insert({ owner_id:userId, client_id:clientId, event_type:"marketer_change", event_title:marketerId?"Marketer assigned":"Marketer removed" });
    setSelClient(prev => prev ? { ...prev, _reassigned:true } : null);
    await load();
  };

  const markNoteComplete = async (noteId) => {
    await supabase.from("brm_notes").update({ is_completed:true }).eq("id",noteId);
    await load();
  };

  // ── AI Insights ───────────────────────────────────────────────────────────
  const generateInsights = useCallback(async () => {
    setLoadingInsight(true); setInsights(null);
    try {
      // Rule-based intelligence engine
      const atRiskClients = clients.filter(c => c.churn_risk === "critical" || c.churn_risk === "high");
      const dormant       = clients.filter(c => daysSince(c.last_interaction_date) > 60);
      const hotLeads      = leads.filter(l => ["proposal","negotiation"].includes(l.stage));
      const thisMonth     = new Date(); thisMonth.setDate(1);
      const newThisMonth  = clients.filter(c => new Date(c.created_at) >= thisMonth).length;
      const topMktr       = marketers.length
        ? marketers.reduce((best,m) => marketerClients(m.id).length > marketerClients(best.id).length ? m : best, marketers[0])
        : null;
      const overdueFU     = notes.filter(n => !n.is_completed && n.follow_up_date && new Date(n.follow_up_date) < new Date());
      const pipelineVal   = leads.filter(l=>!["won","lost"].includes(l.stage)).reduce((s,l)=>s+(l.deal_value||0),0);

      const result = [];

      if (atRiskClients.length > 0)
        result.push({ type:"warning", icon:"🚨", title:`${atRiskClients.length} client${atRiskClients.length>1?"s":""} at high churn risk`,
          body:`${atRiskClients.map(c=>c.company_name).slice(0,3).join(", ")} — schedule re-engagement calls immediately.` });

      if (dormant.length > 0)
        result.push({ type:"action", icon:"💤", title:`${dormant.length} client${dormant.length>1?"s":""} without contact for 60+ days`,
          body:`Consider a check-in campaign. Regular touchpoints reduce churn by up to 40%.` });

      if (hotLeads.length > 0)
        result.push({ type:"opportunity", icon:"🔥", title:`${hotLeads.length} hot lead${hotLeads.length>1?"s":""} in proposal/negotiation`,
          body:`Combined value: ${fmtK(hotLeads.reduce((s,l)=>s+(l.deal_value||0),0))}. Focus here for fastest wins.` });

      if (overdueFU.length > 0)
        result.push({ type:"warning", icon:"🔔", title:`${overdueFU.length} overdue follow-up${overdueFU.length>1?"s":""}`,
          body:`Overdue follow-ups signal missed opportunities. Complete them today.` });

      if (stats.winRate < 30 && leads.length > 5)
        result.push({ type:"insight", icon:"📊", title:`Win rate at ${stats.winRate}% — room to improve`,
          body:`Industry benchmark is 25-35%. Review your proposal quality and response times.` });

      if (pipelineVal > 0)
        result.push({ type:"opportunity", icon:"💰", title:`Active pipeline: ${fmtK(pipelineVal)}`,
          body:`${leads.filter(l=>!["won","lost"].includes(l.stage)).length} deals in motion. Prioritise by expected close date.` });

      if (topMktr && marketers.length > 1)
        result.push({ type:"insight", icon:"⭐", title:`Top performer: ${topMktr.full_name}`,
          body:`Managing ${marketerClients(topMktr.id).length} clients. Share their approach with the team.` });

      if (newThisMonth > 0)
        result.push({ type:"positive", icon:"📈", title:`${newThisMonth} new client${newThisMonth>1?"s":""} this month`,
          body:`Growth is healthy. Ensure onboarding experience matches your acquisition promise.` });

      if (result.length === 0)
        result.push({ type:"positive", icon:"✅", title:"All systems healthy", body:"No immediate risks detected. Keep maintaining regular client touchpoints." });

      setInsights(result);
    } catch(e) { setErr(e.message); }
    finally { setLoadingInsight(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, leads, marketers, notes, stats]);

  // ── TABS ──────────────────────────────────────────────────────────────────
  const TABS = [
    { id:"overview",   label:"Overview",   icon:"🏠" },
    { id:"clients",    label:"Clients",    icon:"🏢" },
    { id:"pipeline",   label:"Pipeline",   icon:"🎯" },
    { id:"team",       label:"Team",       icon:"👥" },
    { id:"commission", label:"Commission", icon:"💰" },
  ];

  // ════════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-900 flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5 pt-12 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-lg font-bold">←</button>
          <div>
            <h1 className="text-lg font-extrabold text-slate-900 dark:text-white leading-tight">BRM & CRM</h1>
            <p className="text-[11px] text-slate-400">Business Relationship Management</p>
          </div>
          {pendingFollowups.length > 0 && (
            <span className="ml-auto text-[10px] font-bold bg-red-500 text-white px-2 py-0.5 rounded-full">
              {pendingFollowups.length} due
            </span>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                tab===t.id ? "bg-violet-600 text-white" : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Error banner ── */}
      {err && (
        <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-100 dark:border-red-800 px-5 py-2 text-xs text-red-600 dark:text-red-400 flex justify-between">
          <span>{err}</span>
          <button onClick={()=>setErr("")} className="font-bold">×</button>
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-[3px] border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {tab === "overview"   && <OverviewTab   />}
            {tab === "clients"    && <ClientsTab    />}
            {tab === "pipeline"   && <PipelineTab   />}
            {tab === "team"       && <TeamTab       />}
            {tab === "commission" && <CommissionTab />}
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {selClient   && <ClientDetail   />}
      {selLead     && <LeadDetail     />}
      {selMarketer && <MarketerDetail />}
      {form        && <FormModal      />}
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  //  OVERVIEW TAB
  // ════════════════════════════════════════════════════════════════════════════
  function OverviewTab() {
    return (
      <div className="p-4 space-y-4 pb-8">
        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard icon="🏢" label="Active Clients"    value={stats.activeClients}        color="violet" onClick={()=>setTab("clients")} />
          <StatCard icon="🎯" label="Pipeline Leads"    value={leads.filter(l=>!["won","lost"].includes(l.stage)).length} sub={fmtK(stats.pipeline)} color="blue" onClick={()=>setTab("pipeline")} />
          <StatCard icon="💰" label="Pending Commission" value={fmtK(stats.pendComm)}      color="amber" onClick={()=>setTab("commission")} />
          <StatCard icon="👥" label="Team Size"          value={marketers.length}           color="green" onClick={()=>setTab("team")} />
        </div>

        {/* Health breakdown */}
        {clients.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-extrabold text-slate-800 dark:text-white">Portfolio Health</h3>
              <span className="text-xs font-bold text-slate-500">{stats.avgHealth}% avg</span>
            </div>
            {[{r:"low",lbl:"Healthy",col:"bg-green-400"},{r:"medium",lbl:"Monitor",col:"bg-amber-400"},{r:"high",lbl:"At Risk",col:"bg-orange-400"},{r:"critical",lbl:"Critical",col:"bg-red-500"}].map(({ r,lbl,col }) => {
              const n = clients.filter(c=>c.churn_risk===r).length;
              const pct = clients.length ? Math.round((n/clients.length)*100) : 0;
              return (
                <div key={r} className="mb-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600 dark:text-slate-400">{lbl}</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300">{n} ({pct}%)</span>
                  </div>
                  <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full ${col} rounded-full transition-all`} style={{ width:`${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* AI Insights */}
        <div className="bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20 rounded-2xl p-4 border border-violet-100 dark:border-violet-800">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-extrabold text-violet-900 dark:text-violet-200">AI Intelligence</h3>
              <p className="text-[10px] text-violet-600 dark:text-violet-400">Smart insights from your data</p>
            </div>
            <button onClick={generateInsights} disabled={loadingInsight}
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-xl disabled:opacity-50 flex items-center gap-1">
              {loadingInsight ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> : "✨"}
              {loadingInsight ? "Analysing…" : "Analyse"}
            </button>
          </div>
          {insights ? (
            <div className="space-y-2">
              {insights.map((ins, i) => (
                <div key={i} className={`rounded-xl px-3 py-2 border text-xs ${
                  ins.type==="warning" ? "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-700" :
                  ins.type==="opportunity" ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-700" :
                  ins.type==="action" ? "bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700" :
                  "bg-white border-slate-200 dark:bg-slate-700 dark:border-slate-600"}`}>
                  <p className="font-bold text-slate-800 dark:text-white mb-0.5">{ins.icon} {ins.title}</p>
                  <p className="text-slate-600 dark:text-slate-400">{ins.body}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-violet-600 dark:text-violet-400 text-center py-3">
              Tap Analyse to generate actionable insights from your BRM data.
            </p>
          )}
        </div>

        {/* Pending follow-ups */}
        {pendingFollowups.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-red-100 dark:border-red-800">
            <h3 className="text-sm font-extrabold text-red-600 mb-3">🔔 Overdue Follow-ups ({pendingFollowups.length})</h3>
            <div className="space-y-2">
              {pendingFollowups.slice(0,5).map(n => (
                <div key={n.id} className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{n.content.slice(0,80)}</p>
                    <p className="text-[10px] text-slate-400">Due {fmtDate(n.follow_up_date)}</p>
                  </div>
                  <button onClick={()=>markNoteComplete(n.id)} className="flex-shrink-0 text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-lg">Done</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent timeline */}
        {timeline.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
            <h3 className="text-sm font-extrabold text-slate-800 dark:text-white mb-3">Recent Activity</h3>
            <div className="space-y-2">
              {timeline.slice(0,8).map(ev => (
                <div key={ev.id} className="flex gap-2 text-xs">
                  <span className="text-base leading-5">{EVENT_ICONS[ev.event_type]||"📌"}</span>
                  <div>
                    <p className="text-slate-700 dark:text-slate-300 font-medium">{ev.event_title}</p>
                    <p className="text-slate-400">{fmtDate(ev.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {clients.length === 0 && leads.length === 0 && (
          <div className="text-center py-8 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
            <p className="text-3xl mb-2">🤝</p>
            <p className="font-bold text-slate-700 dark:text-slate-300">Set up your BRM system</p>
            <p className="text-xs text-slate-400 mt-1 mb-4">Add clients, build your pipeline, and track your team's performance.</p>
            <div className="flex justify-center gap-2 flex-wrap">
              <Btn onClick={()=>{setForm("client");setFd({relationship_type:"client"})}}>+ Add Client</Btn>
              <Btn variant="secondary" onClick={()=>{setForm("lead");setFd({stage:"new",source:"direct"})}}>+ Add Lead</Btn>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  CLIENTS TAB
  // ════════════════════════════════════════════════════════════════════════════
  function ClientsTab() {
    return (
      <div className="p-4 space-y-3 pb-8">
        {/* Toolbar */}
        <div className="flex gap-2">
          <input value={cSearch} onChange={e=>setCSearch(e.target.value)} placeholder="Search clients…"
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          <Btn onClick={()=>{setForm("client");setFd({relationship_type:"client"})}}>+</Btn>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {[["all","All"],["healthy","Healthy"],["at-risk","At Risk"],["inactive","Dormant"]].map(([v,l])=>(
            <button key={v} onClick={()=>setCFilter(v)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold transition-colors ${cFilter===v ? "bg-violet-600 text-white" : "bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600"}`}>
              {l} {v==="all" ? `(${clients.length})` : v==="at-risk" ? `(${clients.filter(c=>["high","critical"].includes(c.churn_risk)).length})` : ""}
            </button>
          ))}
        </div>

        {/* Client list */}
        {filteredClients.length === 0 ? (
          <EmptyState icon="🏢" title="No clients yet" sub="Add your first B2B client to get started" />
        ) : (
          <div className="space-y-2">
            {filteredClients.map(client => (
              <div key={client.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 cursor-pointer active:scale-[0.99] transition-transform"
                onClick={()=>setSelClient(client)}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="font-extrabold text-slate-800 dark:text-white text-sm">{client.company_name}</p>
                    {client.industry && <p className="text-[10px] text-slate-400 mt-0.5">{client.industry}</p>}
                  </div>
                  <HealthBadge score={client.health_score} risk={client.churn_risk} />
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400">
                  {client.contact_name && <span>👤 {client.contact_name}</span>}
                  {clientMarketer(client) && <span>🎯 {clientMarketer(client)}</span>}
                  <span className="ml-auto">{fmtDate(client.last_interaction_date)}</span>
                </div>
                <div className="mt-2 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${client.health_score>=75?"bg-green-400":client.health_score>=55?"bg-amber-400":client.health_score>=35?"bg-orange-400":"bg-red-500"}`}
                    style={{ width:`${client.health_score}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  PIPELINE TAB
  // ════════════════════════════════════════════════════════════════════════════
  function PipelineTab() {
    const activePipe = leads.filter(l=>!["won","lost"].includes(l.stage));
    const pipeVal    = activePipe.reduce((s,l)=>s+(l.deal_value||0),0);
    return (
      <div className="p-4 space-y-3 pb-8">
        {/* Pipeline summary */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
            <p className="text-lg font-extrabold text-slate-800 dark:text-white">{activePipe.length}</p>
            <p className="text-[10px] text-slate-400">Active Leads</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
            <p className="text-lg font-extrabold text-violet-600">{fmtK(pipeVal)}</p>
            <p className="text-[10px] text-slate-400">Pipeline Value</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
            <p className="text-lg font-extrabold text-green-600">{stats.winRate}%</p>
            <p className="text-[10px] text-slate-400">Win Rate</p>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex gap-2">
          <input value={lSearch} onChange={e=>setLSearch(e.target.value)} placeholder="Search leads…"
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
          <Btn onClick={()=>{setForm("lead");setFd({stage:"new",source:"direct",probability:"20"})}}>+</Btn>
        </div>

        {/* Stage filter */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          <button onClick={()=>setLStage("all")} className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold ${lStage==="all"?"bg-violet-600 text-white":"bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600"}`}>All ({leads.length})</button>
          {STAGES.map(s => {
            const n = leads.filter(l=>l.stage===s.id).length;
            return n > 0 ? (
              <button key={s.id} onClick={()=>setLStage(s.id)}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-bold ${lStage===s.id?"bg-violet-600 text-white":"bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600"}`}>
                {s.label} ({n})
              </button>
            ) : null;
          })}
        </div>

        {/* Lead cards */}
        {filteredLeads.length === 0 ? (
          <EmptyState icon="🎯" title="No leads yet" sub="Add your first prospect to build your pipeline" />
        ) : (
          <div className="space-y-2">
            {filteredLeads.map(lead => (
              <div key={lead.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 cursor-pointer active:scale-[0.99] transition-transform"
                onClick={()=>setSelLead(lead)}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="font-extrabold text-slate-800 dark:text-white text-sm">{lead.company_name}</p>
                    {lead.contact_name && <p className="text-[10px] text-slate-400">{lead.contact_name}</p>}
                  </div>
                  <StagePill stage={lead.stage} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 text-[10px] text-slate-500 dark:text-slate-400">
                    {lead.deal_value > 0 && <span className="font-bold text-violet-600">{fmtK(lead.deal_value)}</span>}
                    {lead.brm_marketers?.full_name && <span>🎯 {lead.brm_marketers.full_name}</span>}
                    {lead.industry && <span>{lead.industry}</span>}
                  </div>
                  {lead.probability > 0 && (
                    <span className="text-[10px] font-bold text-slate-500">{lead.probability}% prob.</span>
                  )}
                </div>
                {/* Probability bar */}
                <div className="mt-2 h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-400 rounded-full" style={{ width:`${lead.probability||20}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  TEAM TAB
  // ════════════════════════════════════════════════════════════════════════════
  function TeamTab() {
    const filtered = marketers.filter(m=>!markSearch || m.full_name.toLowerCase().includes(markSearch.toLowerCase()));
    return (
      <div className="p-4 space-y-3 pb-8">
        <div className="flex gap-2">
          <input value={markSearch} onChange={e=>setMarkSearch(e.target.value)} placeholder="Search team…"
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
          <Btn onClick={()=>{setForm("marketer");setFd({commission_rate:"10",target_clients:"20"})}}>+</Btn>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon="👥" title="No team members yet" sub="Add marketers to assign them to clients" />
        ) : (
          <div className="space-y-3">
            {filtered.map(mktr => {
              const myClients = marketerClients(mktr.id);
              const myComm    = marketerComm(mktr.id);
              const earned    = myComm.filter(r=>r.status==="paid").reduce((s,r)=>s+(r.commission_amount||0),0);
              const pending   = myComm.filter(r=>r.status==="pending").reduce((s,r)=>s+(r.commission_amount||0),0);
              const target    = mktr.target_clients || 20;
              const progress  = Math.min(100, Math.round((myClients.length / target) * 100));
              return (
                <div key={mktr.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 cursor-pointer active:scale-[0.99]"
                  onClick={()=>setSelMarketer(mktr)}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center text-lg font-bold text-violet-600">
                      {mktr.full_name.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <p className="font-extrabold text-slate-800 dark:text-white text-sm">{mktr.full_name}</p>
                      <p className="text-[10px] text-slate-400">{mktr.territory || "No territory"} · {mktr.commission_rate}% commission</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-green-600">{fmt(earned)}</p>
                      <p className="text-[10px] text-slate-400">earned</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-[10px] mb-3">
                    <div><p className="font-bold text-slate-700 dark:text-slate-300">{myClients.length}</p><p className="text-slate-400">Clients</p></div>
                    <div><p className="font-bold text-amber-600">{fmt(pending)}</p><p className="text-slate-400">Pending</p></div>
                    <div><p className="font-bold text-slate-700 dark:text-slate-300">{myComm.length}</p><p className="text-slate-400">Deals</p></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1">
                      <span>Target progress</span>
                      <span>{myClients.length}/{target}</span>
                    </div>
                    <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${progress>=100?"bg-green-500":progress>=60?"bg-violet-500":"bg-amber-400"}`}
                        style={{ width:`${progress}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  COMMISSION TAB
  // ════════════════════════════════════════════════════════════════════════════
  function CommissionTab() {
    const pending  = commRecs.filter(r=>r.status==="pending").reduce((s,r)=>s+(r.commission_amount||0),0);
    const paid     = commRecs.filter(r=>r.status==="paid").reduce((s,r)=>s+(r.commission_amount||0),0);
    const disputed = commRecs.filter(r=>r.status==="disputed").length;
    const [view,setView] = useState("records"); // "records" | "rules"
    return (
      <div className="p-4 space-y-3 pb-8">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-center">
            <p className="text-base font-extrabold text-amber-700 dark:text-amber-400">{fmtK(pending)}</p>
            <p className="text-[10px] text-amber-600">Pending</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 text-center">
            <p className="text-base font-extrabold text-green-700 dark:text-green-400">{fmtK(paid)}</p>
            <p className="text-[10px] text-green-600">Paid Out</p>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 text-center">
            <p className="text-base font-extrabold text-red-700 dark:text-red-400">{disputed}</p>
            <p className="text-[10px] text-red-600">Disputed</p>
          </div>
        </div>

        {/* Sub-tab */}
        <div className="flex gap-2">
          <button onClick={()=>setView("records")} className={`flex-1 py-2 text-xs font-bold rounded-xl ${view==="records"?"bg-violet-600 text-white":"bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600"}`}>
            Records ({commRecs.length})
          </button>
          <button onClick={()=>setView("rules")} className={`flex-1 py-2 text-xs font-bold rounded-xl ${view==="rules"?"bg-violet-600 text-white":"bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600"}`}>
            Rules ({commRules.length})
          </button>
        </div>

        {view === "records" && (
          <>
            <Btn onClick={()=>{setForm("record");setFd({commission_type:"acquisition"})}}>+ Record Commission</Btn>
            {commRecs.length === 0 ? (
              <EmptyState icon="💰" title="No commission records" sub="Records are created automatically when leads are converted" />
            ) : (
              <div className="space-y-2">
                {commRecs.map(rec => (
                  <div key={rec.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div>
                        <p className="text-sm font-bold text-slate-800 dark:text-white">{rec.brm_marketers?.full_name || "Unknown"}</p>
                        <p className="text-[10px] text-slate-400">{rec.brm_clients?.company_name || rec.commission_type} · {fmtDate(rec.created_at)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-extrabold text-violet-600">{fmt(rec.commission_amount)}</p>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          rec.status==="paid"?"bg-green-100 text-green-700":
                          rec.status==="pending"?"bg-amber-100 text-amber-700":
                          rec.status==="disputed"?"bg-red-100 text-red-700":"bg-slate-100 text-slate-600"}`}>
                          {rec.status}
                        </span>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-400 mb-2">Deal: {fmt(rec.deal_value)} @ {rec.rate}%</p>
                    {rec.status === "pending" && (
                      <div className="flex gap-2">
                        <Btn small variant="green" onClick={()=>updateCommStatus(rec.id,"paid")}>Mark Paid</Btn>
                        <Btn small variant="danger" onClick={()=>updateCommStatus(rec.id,"disputed")}>Dispute</Btn>
                        <Btn small variant="secondary" onClick={()=>updateCommStatus(rec.id,"approved")}>Approve</Btn>
                      </div>
                    )}
                    {rec.status === "approved" && (
                      <Btn small variant="green" onClick={()=>updateCommStatus(rec.id,"paid")}>Mark Paid</Btn>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {view === "rules" && (
          <>
            <Btn onClick={()=>{setForm("rule");setFd({rule_type:"acquisition",ownership_period_months:"12"})}}>+ Add Rule</Btn>
            {commRules.length === 0 ? (
              <EmptyState icon="📋" title="No commission rules" sub="Define commission structures for your team" />
            ) : (
              <div className="space-y-2">
                {commRules.map(rule => (
                  <div key={rule.id} className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-bold text-slate-800 dark:text-white text-sm">{rule.rule_name}</p>
                        <p className="text-[10px] text-slate-400 capitalize">{rule.rule_type} · {rule.ownership_period_months}mo ownership</p>
                      </div>
                      <span className="text-lg font-extrabold text-violet-600">{rule.rate}%</span>
                    </div>
                    {rule.min_deal_value > 0 && <p className="text-[10px] text-slate-400 mt-1">Min deal: {fmt(rule.min_deal_value)}</p>}
                    {rule.notes && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{rule.notes}</p>}
                    <div className="flex gap-2 mt-2">
                      <Btn small variant="secondary" onClick={()=>{setEditItem(rule);setFd({rule_name:rule.rule_name,rule_type:rule.rule_type,rate:String(rule.rate),min_deal_value:String(rule.min_deal_value/1000||""),ownership_period_months:String(rule.ownership_period_months),notes:rule.notes||""});setForm("rule");}}>Edit</Btn>
                      <Btn small variant="danger" onClick={async()=>{await supabase.from("commission_rules").delete().eq("id",rule.id);load();}}>Delete</Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  CLIENT DETAIL MODAL
  // ════════════════════════════════════════════════════════════════════════════
  function ClientDetail() {
    const c       = selClient;
    const myNotes = clientNotes(c.id);
    const myTL    = clientTimeline(c.id);
    const mktrId  = c.brm_assignments?.find(a=>a.is_current)?.marketer_id ?? "";
    const [activeTab, setActiveTab] = useState("info");
    const [assignMktr, setAssignMktr] = useState(mktrId);

    return (
      <Sheet title={c.company_name} onClose={()=>setSelClient(null)} wide>
        <div className="flex items-center gap-2 mb-2">
          <HealthBadge score={c.health_score} risk={c.churn_risk} />
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 capitalize`}>{c.relationship_type}</span>
          {c.kyc_status && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.kyc_status==="verified"?"bg-green-100 text-green-700":"bg-amber-100 text-amber-700"}`}>KYC: {c.kyc_status}</span>}
        </div>

        {/* Sub-tabs */}
        <div className="flex gap-1 border-b border-slate-100 dark:border-slate-700 mb-3">
          {["info","notes","timeline"].map(t=>(
            <button key={t} onClick={()=>setActiveTab(t)}
              className={`px-3 py-2 text-xs font-bold capitalize ${activeTab===t?"text-violet-600 border-b-2 border-violet-600":"text-slate-500 dark:text-slate-400"}`}>
              {t} {t==="notes"?`(${myNotes.length})`:t==="timeline"?`(${myTL.length})`:""}</button>
          ))}
        </div>

        {activeTab === "info" && (
          <div className="space-y-3">
            {[
              ["Company",c.company_name],["Industry",c.industry],["Size",c.business_size],
              ["Employees",c.employee_count],["Revenue",c.annual_revenue ? fmt(c.annual_revenue) : null],
              ["Website",c.website],["CAC No.",c.cac_number],
              ["Contact",c.contact_name],["Email",c.contact_email],["Phone",c.contact_phone],
              ["Address",c.address],["State",c.state],
              ["Since",fmtDate(c.acquisition_date)],["Last Contact",fmtDate(c.last_interaction_date)],
            ].filter(([,v])=>v).map(([k,v])=>(
              <div key={k} className="flex justify-between items-start gap-2 text-sm">
                <span className="text-slate-500 dark:text-slate-400 text-xs font-medium">{k}</span>
                <span className="font-semibold text-slate-800 dark:text-white text-xs text-right max-w-[60%]">{v}</span>
              </div>
            ))}
            {c.notes && <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700 rounded-xl p-3">{c.notes}</p>}

            {/* Assign marketer */}
            <div className="border-t border-slate-100 dark:border-slate-700 pt-3">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Assigned Marketer</p>
              <div className="flex gap-2">
                <select value={assignMktr} onChange={e=>setAssignMktr(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                  <option value="">— Unassigned —</option>
                  {marketers.map(m=><option key={m.id} value={m.id}>{m.full_name}</option>)}
                </select>
                <Btn onClick={()=>assignMarketer(c.id,assignMktr||null)}>Save</Btn>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 pt-1">
              <Btn small onClick={()=>{setFd({client_id:c.id,note_type:"note"});setForm("note")}}>+ Note</Btn>
              <Btn small onClick={()=>{setFd({client_id:c.id,note_type:"meeting"});setForm("note")}}>📅 Meeting</Btn>
              <Btn small onClick={()=>{setFd({client_id:c.id,note_type:"follow_up"});setForm("note")}}>🔔 Follow-up</Btn>
              <Btn small variant="secondary" onClick={()=>{setEditItem(c);setFd({company_name:c.company_name,industry:c.industry||"",business_size:c.business_size||"",contact_name:c.contact_name||"",contact_email:c.contact_email||"",contact_phone:c.contact_phone||"",cac_number:c.cac_number||"",kyc_status:c.kyc_status||"pending",address:c.address||"",state:c.state||"",relationship_type:c.relationship_type||"client",notes:c.notes||""});setForm("client")}}>Edit</Btn>
            </div>
          </div>
        )}

        {activeTab === "notes" && (
          <div className="space-y-3">
            <Btn small onClick={()=>{setFd({client_id:c.id,note_type:"note"});setForm("note")}}>+ Add Note</Btn>
            {myNotes.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">No notes yet. Record your first interaction.</p>
            ) : myNotes.map(n => (
              <div key={n.id} className={`rounded-xl p-3 border text-xs ${n.is_completed?"opacity-50 bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600":"bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-600 dark:text-slate-300 capitalize">{NOTE_ICONS[n.note_type]||"📝"} {n.note_type.replace("_"," ")}</span>
                  <span className="text-slate-400">{fmtDate(n.created_at)}</span>
                </div>
                <p className="text-slate-700 dark:text-slate-200">{n.content}</p>
                {n.follow_up_date && <p className={`mt-1 font-semibold ${new Date(n.follow_up_date)<new Date()&&!n.is_completed?"text-red-500":"text-violet-600"}`}>📅 Follow-up: {fmtDate(n.follow_up_date)}</p>}
                {!n.is_completed && <button onClick={()=>markNoteComplete(n.id)} className="mt-2 text-[10px] font-bold text-green-600">✓ Mark complete</button>}
              </div>
            ))}
          </div>
        )}

        {activeTab === "timeline" && (
          <div className="space-y-2">
            {myTL.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">No activity recorded yet.</p>
            ) : myTL.map(ev => (
              <div key={ev.id} className="flex gap-3 text-xs">
                <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center bg-violet-50 dark:bg-violet-900/30 rounded-full text-base">
                  {EVENT_ICONS[ev.event_type]||"📌"}
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-800 dark:text-white">{ev.event_title}</p>
                  <p className="text-slate-400">{fmtDate(ev.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Sheet>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  LEAD DETAIL MODAL
  // ════════════════════════════════════════════════════════════════════════════
  function LeadDetail() {
    const l = selLead;
    return (
      <Sheet title={l.company_name} onClose={()=>setSelLead(null)}>
        <div className="space-y-3">
          <div className="flex gap-2 items-center flex-wrap">
            <StagePill stage={l.stage} />
            {l.deal_value > 0 && <span className="text-sm font-extrabold text-violet-600">{fmt(l.deal_value)}</span>}
            {l.probability > 0 && <span className="text-xs text-slate-500">{l.probability}% probability</span>}
          </div>

          {[
            ["Contact",l.contact_name],["Email",l.contact_email],["Phone",l.contact_phone],
            ["Industry",l.industry],["Source",l.source],
            ["Marketer",l.brm_marketers?.full_name],
            ["Expected Close",fmtDate(l.expected_close_date)],["Added",fmtDate(l.created_at)],
          ].filter(([,v])=>v).map(([k,v])=>(
            <div key={k} className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400 text-xs">{k}</span>
              <span className="font-semibold text-slate-800 dark:text-white text-xs">{v}</span>
            </div>
          ))}

          {l.notes && <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-700 rounded-xl p-3">{l.notes}</p>}
          {l.lost_reason && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl p-3">Lost reason: {l.lost_reason}</p>}

          {/* Stage changer */}
          <div>
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Move to stage</p>
            <div className="flex gap-1.5 flex-wrap">
              {STAGES.filter(s=>s.id!=="won"&&s.id!=="lost").map(s=>(
                <button key={s.id} onClick={async()=>{await supabase.from("crm_leads").update({stage:s.id,last_activity_at:new Date().toISOString()}).eq("id",l.id);setSelLead({...l,stage:s.id});load();}}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${l.stage===s.id?"bg-violet-600 text-white border-violet-600":s.color+" border-transparent"}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {!["won","lost"].includes(l.stage) && (
              <Btn variant="green" onClick={()=>convertLead(l)} disabled={saving}>
                {saving?"Converting…":"✓ Convert to Client"}
              </Btn>
            )}
            <Btn variant="secondary" onClick={()=>{setEditItem(l);setFd({company_name:l.company_name,contact_name:l.contact_name||"",contact_email:l.contact_email||"",contact_phone:l.contact_phone||"",industry:l.industry||"",source:l.source||"direct",stage:l.stage||"new",deal_value:String(l.deal_value||""),probability:String(l.probability||20),expected_close_date:l.expected_close_date||"",marketer_id:l.marketer_id||"",notes:l.notes||""});setForm("lead");setSelLead(null);}}>
              Edit
            </Btn>
            <Btn variant="danger" onClick={async()=>{if(window.confirm("Mark this lead as lost?")){await supabase.from("crm_leads").update({stage:"lost"}).eq("id",l.id);setSelLead(null);load();}}}>Lost</Btn>
          </div>
        </div>
      </Sheet>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  MARKETER DETAIL MODAL
  // ════════════════════════════════════════════════════════════════════════════
  function MarketerDetail() {
    const m       = selMarketer;
    const myC     = marketerClients(m.id);
    const myComm  = marketerComm(m.id);
    const earned  = myComm.filter(r=>r.status==="paid").reduce((s,r)=>s+(r.commission_amount||0),0);
    const pending = myComm.filter(r=>r.status==="pending").reduce((s,r)=>s+(r.commission_amount||0),0);
    return (
      <Sheet title={m.full_name} onClose={()=>setSelMarketer(null)}>
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-violet-50 dark:bg-violet-900/20 rounded-xl p-3">
              <p className="text-lg font-extrabold text-violet-600">{myC.length}</p>
              <p className="text-[10px] text-violet-500">Clients</p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3">
              <p className="text-lg font-extrabold text-green-600">{fmtK(earned)}</p>
              <p className="text-[10px] text-green-500">Earned</p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
              <p className="text-lg font-extrabold text-amber-600">{fmtK(pending)}</p>
              <p className="text-[10px] text-amber-500">Pending</p>
            </div>
          </div>

          {/* Info */}
          {[["Email",m.email],["Phone",m.phone],["Territory",m.territory],["Commission",`${m.commission_rate}%`],["Target",`${m.target_clients} clients`],["Joined",fmtDate(m.joined_date)]].filter(([,v])=>v).map(([k,v])=>(
            <div key={k} className="flex justify-between text-sm">
              <span className="text-slate-400 text-xs">{k}</span>
              <span className="font-semibold text-slate-800 dark:text-white text-xs">{v}</span>
            </div>
          ))}

          {/* Clients */}
          {myC.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-600 dark:text-slate-400 mb-2">Client Portfolio</p>
              <div className="space-y-1.5">
                {myC.slice(0,6).map(c=>(
                  <div key={c.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-700 rounded-xl px-3 py-2">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{c.company_name}</span>
                    <HealthBadge score={c.health_score} risk={c.churn_risk} />
                  </div>
                ))}
                {myC.length > 6 && <p className="text-[10px] text-center text-slate-400">+{myC.length-6} more</p>}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Btn small variant="secondary" onClick={()=>{setEditItem(m);setFd({full_name:m.full_name,email:m.email||"",phone:m.phone||"",territory:m.territory||"",commission_rate:String(m.commission_rate),target_clients:String(m.target_clients)});setForm("marketer");setSelMarketer(null);}}>Edit</Btn>
            <Btn small variant="danger" onClick={async()=>{if(window.confirm("Deactivate this marketer?")){await supabase.from("brm_marketers").update({status:"inactive"}).eq("id",m.id);setSelMarketer(null);load();}}}>Deactivate</Btn>
          </div>
        </div>
      </Sheet>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  FORM MODALS
  // ════════════════════════════════════════════════════════════════════════════
  function FormModal() {
    const title = { client:"Add Client", lead:"Add Lead", marketer:"Add Marketer", note:"Add Note", rule:"Commission Rule", record:"Record Commission" }[form];
    const handleSave = { client:saveClient, lead:saveLead, marketer:saveMarketer, note:saveNote, rule:saveRule, record:saveRecord }[form];
    return (
      <Sheet title={(editItem?"Edit ":"")+(title||"")} onClose={()=>{setForm(null);setFd({});setEditItem(null);}}>
        {form === "client" && (
          <div className="space-y-3">
            <Inp label="Company Name" value={fd.company_name} onChange={v=>set("company_name",v)} required placeholder="e.g. Acme Ltd" />
            <div className="grid grid-cols-2 gap-3">
              <Sel label="Relationship Type" value={fd.relationship_type||"client"} onChange={v=>set("relationship_type",v)}
                options={[{value:"lead",label:"Lead"},{value:"prospect",label:"Prospect"},{value:"client",label:"Client"},{value:"partner",label:"Partner"},{value:"inactive",label:"Inactive"}]} />
              <Sel label="Industry" value={fd.industry||""} onChange={v=>set("industry",v)}
                options={[{value:"",label:"— Select —"},...INDUSTRIES.map(i=>({value:i,label:i}))]} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Sel label="Business Size" value={fd.business_size||""} onChange={v=>set("business_size",v)}
                options={[{value:"",label:"— Select —"},{value:"micro",label:"Micro (1-5)"},{value:"small",label:"Small (6-49)"},{value:"medium",label:"Medium (50-249)"},{value:"large",label:"Large (250+)"},{value:"enterprise",label:"Enterprise"}]} />
              <Inp label="Employees" value={fd.employee_count} onChange={v=>set("employee_count",v)} type="number" placeholder="e.g. 20" />
            </div>
            <Inp label="Contact Person" value={fd.contact_name} onChange={v=>set("contact_name",v)} placeholder="Full name" />
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Email" value={fd.contact_email} onChange={v=>set("contact_email",v)} type="email" />
              <Inp label="Phone" value={fd.contact_phone} onChange={v=>set("contact_phone",v)} type="tel" />
            </div>
            <Inp label="CAC / Reg. Number" value={fd.cac_number} onChange={v=>set("cac_number",v)} placeholder="RC000000" />
            <Sel label="KYC Status" value={fd.kyc_status||"pending"} onChange={v=>set("kyc_status",v)}
              options={[{value:"pending",label:"Pending"},{value:"submitted",label:"Submitted"},{value:"verified",label:"Verified"},{value:"rejected",label:"Rejected"}]} />
            <Inp label="Address" value={fd.address} onChange={v=>set("address",v)} />
            <Inp label="State" value={fd.state} onChange={v=>set("state",v)} placeholder="e.g. Lagos" />
            <Sel label="Assign Marketer" value={fd.marketer_id||""} onChange={v=>set("marketer_id",v)}
              options={[{value:"",label:"— Unassigned —"},...marketers.map(m=>({value:m.id,label:m.full_name}))]} />
            <Textarea label="Notes" value={fd.notes} onChange={v=>set("notes",v)} placeholder="Internal notes…" />
          </div>
        )}

        {form === "lead" && (
          <div className="space-y-3">
            <Inp label="Company / Prospect Name" value={fd.company_name} onChange={v=>set("company_name",v)} required />
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Contact Person" value={fd.contact_name} onChange={v=>set("contact_name",v)} />
              <Inp label="Phone" value={fd.contact_phone} onChange={v=>set("contact_phone",v)} type="tel" />
            </div>
            <Inp label="Email" value={fd.contact_email} onChange={v=>set("contact_email",v)} type="email" />
            <div className="grid grid-cols-2 gap-3">
              <Sel label="Stage" value={fd.stage||"new"} onChange={v=>set("stage",v)} options={STAGES.map(s=>({value:s.id,label:s.label}))} />
              <Sel label="Source" value={fd.source||"direct"} onChange={v=>set("source",v)} options={SOURCES} />
            </div>
            <Sel label="Industry" value={fd.industry||""} onChange={v=>set("industry",v)}
              options={[{value:"",label:"— Select —"},...INDUSTRIES.map(i=>({value:i,label:i}))]} />
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Deal Value (₦)" value={fd.deal_value} onChange={v=>set("deal_value",v)} type="number" placeholder="0" />
              <Inp label="Probability (%)" value={fd.probability} onChange={v=>set("probability",v)} type="number" placeholder="20" />
            </div>
            <Inp label="Expected Close Date" value={fd.expected_close_date} onChange={v=>set("expected_close_date",v)} type="date" />
            <Sel label="Assign Marketer" value={fd.marketer_id||""} onChange={v=>set("marketer_id",v)}
              options={[{value:"",label:"— Unassigned —"},...marketers.map(m=>({value:m.id,label:m.full_name}))]} />
            <Textarea label="Notes" value={fd.notes} onChange={v=>set("notes",v)} />
          </div>
        )}

        {form === "marketer" && (
          <div className="space-y-3">
            <Inp label="Full Name" value={fd.full_name} onChange={v=>set("full_name",v)} required />
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Email" value={fd.email} onChange={v=>set("email",v)} type="email" />
              <Inp label="Phone" value={fd.phone} onChange={v=>set("phone",v)} type="tel" />
            </div>
            <Inp label="Territory / Region" value={fd.territory} onChange={v=>set("territory",v)} placeholder="e.g. Lagos, Abuja" />
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Commission Rate (%)" value={fd.commission_rate} onChange={v=>set("commission_rate",v)} type="number" placeholder="10" />
              <Inp label="Target Clients" value={fd.target_clients} onChange={v=>set("target_clients",v)} type="number" placeholder="20" />
            </div>
          </div>
        )}

        {form === "note" && (
          <div className="space-y-3">
            <Sel label="Note Type" value={fd.note_type||"note"} onChange={v=>set("note_type",v)}
              options={["note","meeting","call","visit","email","follow_up","complaint"].map(t=>({value:t,label:`${NOTE_ICONS[t]} ${t.replace("_"," ")}`}))} />
            {!fd.client_id && (
              <Sel label="Client" value={fd.client_id||""} onChange={v=>set("client_id",v)}
                options={[{value:"",label:"— Select Client —"},...clients.map(c=>({value:c.id,label:c.company_name}))]} />
            )}
            <Sel label="Marketer (optional)" value={fd.marketer_id||""} onChange={v=>set("marketer_id",v)}
              options={[{value:"",label:"— None —"},...marketers.map(m=>({value:m.id,label:m.full_name}))]} />
            <Textarea label="Content" value={fd.content} onChange={v=>set("content",v)} required placeholder="What happened? What was discussed?" rows={4} />
            <Inp label="Follow-up Date (optional)" value={fd.follow_up_date} onChange={v=>set("follow_up_date",v)} type="date" />
          </div>
        )}

        {form === "rule" && (
          <div className="space-y-3">
            <Inp label="Rule Name" value={fd.rule_name} onChange={v=>set("rule_name",v)} required placeholder="e.g. Standard Acquisition" />
            <div className="grid grid-cols-2 gap-3">
              <Sel label="Type" value={fd.rule_type||"acquisition"} onChange={v=>set("rule_type",v)}
                options={[{value:"acquisition",label:"Acquisition"},{value:"renewal",label:"Renewal"},{value:"upsell",label:"Upsell"},{value:"retention",label:"Retention"}]} />
              <Inp label="Commission Rate (%)" value={fd.rate} onChange={v=>set("rate",v)} type="number" required placeholder="10" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Min Deal Value (₦)" value={fd.min_deal_value} onChange={v=>set("min_deal_value",v)} type="number" placeholder="0" />
              <Inp label="Ownership Period (months)" value={fd.ownership_period_months} onChange={v=>set("ownership_period_months",v)} type="number" placeholder="12" />
            </div>
            <Textarea label="Notes" value={fd.notes} onChange={v=>set("notes",v)} placeholder="Describe when this rule applies…" rows={2} />
          </div>
        )}

        {form === "record" && (
          <div className="space-y-3">
            <Sel label="Marketer" value={fd.marketer_id||""} onChange={v=>{set("marketer_id",v);const m=marketers.find(x=>x.id===v);if(m)set("rate",String(m.commission_rate));}} required
              options={[{value:"",label:"— Select Marketer —"},...marketers.map(m=>({value:m.id,label:m.full_name}))]} />
            <Sel label="Client (optional)" value={fd.client_id||""} onChange={v=>set("client_id",v)}
              options={[{value:"",label:"— Select Client —"},...clients.map(c=>({value:c.id,label:c.company_name}))]} />
            <div className="grid grid-cols-2 gap-3">
              <Inp label="Deal Value (₦)" value={fd.deal_value} onChange={v=>set("deal_value",v)} type="number" required placeholder="0" />
              <Inp label="Commission Rate (%)" value={fd.rate} onChange={v=>set("rate",v)} type="number" placeholder="10" />
            </div>
            {fd.deal_value && fd.rate && (
              <div className="bg-violet-50 dark:bg-violet-900/20 rounded-xl p-3 text-sm">
                <span className="text-slate-500">Commission: </span>
                <span className="font-extrabold text-violet-600">{fmt(Math.round(+fd.deal_value * (+fd.rate/100)))}</span>
              </div>
            )}
            <Sel label="Type" value={fd.commission_type||"acquisition"} onChange={v=>set("commission_type",v)}
              options={[{value:"acquisition",label:"Acquisition"},{value:"renewal",label:"Renewal"},{value:"upsell",label:"Upsell"},{value:"retention",label:"Retention"}]} />
            <Textarea label="Notes" value={fd.notes} onChange={v=>set("notes",v)} rows={2} />
          </div>
        )}

        {/* Error + actions */}
        {err && <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{err}</p>}
        <div className="flex gap-3 pt-1">
          <Btn onClick={handleSave} disabled={saving} variant="primary">
            {saving ? "Saving…" : editItem ? "Update" : "Save"}
          </Btn>
          <Btn onClick={()=>{setForm(null);setFd({});setEditItem(null);}} variant="secondary">Cancel</Btn>
        </div>
      </Sheet>
    );
  }
}
