import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmt = (n) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(n || 0);

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" }) : "—";

async function callPortal(session, action, extra = {}) {
  const { data, error } = await supabase.functions.invoke("admin-portal", {
    body: { action, ...extra },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw new Error(error.message || "Portal error");
  return data;
}

// ── Stat Card ──────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = "blue" }) {
  const colors = {
    blue:   "from-blue-600 to-blue-700",
    green:  "from-emerald-600 to-emerald-700",
    purple: "from-purple-600 to-purple-700",
    orange: "from-orange-500 to-orange-600",
    red:    "from-red-600 to-red-700",
    teal:   "from-teal-600 to-teal-700",
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color]} rounded-2xl p-4 text-white shadow-lg`}>
      <p className="text-xs font-medium opacity-80 uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs opacity-70 mt-1">{sub}</p>}
    </div>
  );
}

// ── Badge ──────────────────────────────────────────────────────────────────────
function Badge({ text, type = "info" }) {
  const styles = {
    info:    "bg-blue-100 text-blue-700",
    success: "bg-emerald-100 text-emerald-700",
    warn:    "bg-amber-100 text-amber-700",
    danger:  "bg-red-100 text-red-700",
    neutral: "bg-slate-100 text-slate-600",
  };
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${styles[type]}`}>{text}</span>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────────
function Spin() {
  return <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />;
}

// ── Overview Section ───────────────────────────────────────────────────────────
function Overview({ session }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    callPortal(session, "get-stats")
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session]);

  if (loading) return <div className="flex justify-center py-16"><Spin /></div>;
  if (!stats)  return <p className="text-slate-400 text-center py-8">Failed to load stats.</p>;

  const plans = stats.planCounts || {};

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-800">Platform Overview</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label="Businesses"    value={stats.businesses.toLocaleString()} color="blue" />
        <StatCard label="Active Subs"   value={stats.activeSubs.toLocaleString()} color="green" />
        <StatCard label="Monthly Rev"   value={fmt(stats.mrr)} sub="from active subs" color="purple" />
        <StatCard label="Organisations" value={stats.orgs.toLocaleString()} color="teal" />
        <StatCard label="Ajo Clients"   value={stats.ajoClients.toLocaleString()} color="orange" />
        <StatCard label="Open Alerts"   value={stats.openAlerts} color={stats.openAlerts > 0 ? "red" : "green"} />
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Subscription Breakdown</h3>
        <div className="space-y-3">
          {[
            { label: "Starter", plan: "starter", price: 0,     color: "bg-slate-400" },
            { label: "Basic",   plan: "basic",   price: 2000,  color: "bg-blue-500"  },
            { label: "Pro",     plan: "professional", price: 5000, color: "bg-purple-500" },
            { label: "Enterprise", plan: "enterprise", price: 15000, color: "bg-amber-500" },
          ].map(({ label, plan, price, color }) => {
            const count = plans[plan] || 0;
            const pct   = stats.activeSubs > 0 ? Math.round((count / stats.activeSubs) * 100) : 0;
            return (
              <div key={plan}>
                <div className="flex justify-between text-xs text-slate-600 mb-1">
                  <span>{label} {price > 0 ? `(${fmt(price)}/mo)` : "(Free)"}</span>
                  <span className="font-medium">{count} businesses · {pct}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm text-center">
          <p className="text-2xl font-bold text-slate-800">{stats.staff.toLocaleString()}</p>
          <p className="text-xs text-slate-500 mt-1">Total Staff</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm text-center">
          <p className="text-2xl font-bold text-slate-800">{stats.orgMembers.toLocaleString()}</p>
          <p className="text-xs text-slate-500 mt-1">Org Members</p>
        </div>
      </div>
    </div>
  );
}

// ── Users Section ──────────────────────────────────────────────────────────────
function Users({ session }) {
  const [users, setUsers]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState("");
  const [loading, setLoading] = useState(true);
  const [acting, setActing]   = useState(null);
  const [toast, setToast]     = useState("");

  const load = useCallback((p = 1, q = search) => {
    setLoading(true);
    callPortal(session, "get-users", { page: String(p), search: q })
      .then(d => { setUsers(d.users); setTotal(d.total); setPage(p); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session, search]);

  useEffect(() => { load(1, ""); }, [session]); // eslint-disable-line

  const doAction = async (userId, act) => {
    if (!window.confirm(`${act} this user?`)) return;
    setActing(userId);
    try {
      await callPortal(session, "user-action", { target_id: userId, user_action: act });
      setToast(`User ${act}d successfully.`);
      setTimeout(() => setToast(""), 3000);
      load(page);
    } catch (e) {
      alert(e.message);
    } finally {
      setActing(null);
    }
  };

  const planBadge = (sub) => {
    if (!sub?.[0]) return <Badge text="No Sub" type="neutral" />;
    const { plan, status } = sub[0];
    if (status !== "active") return <Badge text={`${plan} (${status})`} type="warn" />;
    const types = { starter: "neutral", basic: "info", professional: "success", enterprise: "warn" };
    return <Badge text={plan} type={types[plan] || "info"} />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">Business Users <span className="text-slate-400 font-normal text-base">({total})</span></h2>
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && load(1, search)}
        />
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700"
          onClick={() => load(1, search)}
        >Search</button>
      </div>

      {toast && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl px-4 py-2">{toast}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Spin /></div>
      ) : (
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 text-sm truncate">{u.business_name || "—"}</p>
                  <p className="text-xs text-slate-500">{u.owner_name} · {u.email}</p>
                  <p className="text-xs text-slate-400 mt-1">Joined {fmtDate(u.created_at)}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {planBadge(u.subscriptions)}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => doAction(u.id, "suspend")}
                  disabled={acting === u.id}
                  className="flex-1 text-xs py-1.5 rounded-lg bg-amber-50 text-amber-700 font-medium hover:bg-amber-100 disabled:opacity-50"
                >Suspend</button>
                <button
                  onClick={() => doAction(u.id, "activate")}
                  disabled={acting === u.id}
                  className="flex-1 text-xs py-1.5 rounded-lg bg-emerald-50 text-emerald-700 font-medium hover:bg-emerald-100 disabled:opacity-50"
                >Activate</button>
                <button
                  onClick={() => doAction(u.id, "delete")}
                  disabled={acting === u.id}
                  className="flex-1 text-xs py-1.5 rounded-lg bg-red-50 text-red-700 font-medium hover:bg-red-100 disabled:opacity-50"
                >Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && total > 25 && (
        <div className="flex justify-center gap-3">
          <button
            disabled={page === 1}
            onClick={() => load(page - 1)}
            className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm disabled:opacity-40"
          >← Prev</button>
          <span className="px-3 py-2 text-sm text-slate-500">Page {page} of {Math.ceil(total / 25)}</span>
          <button
            disabled={page * 25 >= total}
            onClick={() => load(page + 1)}
            className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm disabled:opacity-40"
          >Next →</button>
        </div>
      )}
    </div>
  );
}

// ── Finance Section ────────────────────────────────────────────────────────────
function Finance({ session }) {
  const [subs, setSubs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState("all");

  useEffect(() => {
    callPortal(session, "get-subscriptions")
      .then(d => setSubs(d.subs))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session]);

  const filtered = filter === "all" ? subs : subs.filter(s => s.plan === filter);
  const revenue  = subs.filter(s => s.status === "active").reduce((t, s) => t + (({ starter: 0, basic: 2000, professional: 5000, enterprise: 15000 })[s.plan] || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">Finance</h2>
        <span className="text-sm font-semibold text-emerald-600">{fmt(revenue)}/mo</span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {["all", "starter", "basic", "professional", "enterprise"].map(p => (
          <button
            key={p}
            onClick={() => setFilter(p)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === p ? "bg-blue-600 text-white" : "bg-white border border-slate-200 text-slate-600"}`}
          >{p === "all" ? "All Plans" : p.charAt(0).toUpperCase() + p.slice(1)}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spin /></div>
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, 50).map(s => (
            <div key={s.id} className="bg-white rounded-xl p-3 border border-slate-100 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{s.profiles?.business_name || s.profiles?.owner_name || "Unknown"}</p>
                <p className="text-xs text-slate-400">{s.profiles?.email}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <Badge text={s.plan} type={s.status === "active" ? "success" : "warn"} />
                <p className="text-xs text-slate-400 mt-1">{fmtDate(s.created_at)}</p>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <p className="text-center text-slate-400 py-8 text-sm">No subscriptions found.</p>}
        </div>
      )}
    </div>
  );
}

// ── Organisations Section ──────────────────────────────────────────────────────
function Organisations({ session }) {
  const [orgs, setOrgs]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    callPortal(session, "get-orgs")
      .then(d => setOrgs(d.orgs))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-slate-800">Organisations <span className="text-slate-400 font-normal text-base">({orgs.length})</span></h2>
      {loading ? (
        <div className="flex justify-center py-12"><Spin /></div>
      ) : (
        <div className="space-y-2">
          {orgs.map(o => (
            <div key={o.id} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">{o.name}</p>
                  <p className="text-xs text-slate-500 capitalize">{o.type?.replace(/_/g, " ")}</p>
                  <p className="text-xs text-slate-400 mt-0.5">Owner: {o.profiles?.business_name || "—"}</p>
                </div>
                <Badge text={o.status || "active"} type={o.status === "active" ? "success" : "neutral"} />
              </div>
              <div className="flex gap-4 mt-3 text-xs text-slate-500">
                <span><span className="font-semibold text-slate-700">{o.member_count || 0}</span> members</span>
                <span><span className="font-semibold text-slate-700">{fmt(o.wallet_balance || 0)}</span> wallet</span>
                <span><span className="font-semibold text-slate-700">{fmt(o.total_savings || 0)}</span> savings</span>
              </div>
            </div>
          ))}
          {orgs.length === 0 && <p className="text-center text-slate-400 py-8 text-sm">No organisations found.</p>}
        </div>
      )}
    </div>
  );
}

// ── Security Section ───────────────────────────────────────────────────────────
function Security({ session }) {
  const [events, setEvents]   = useState([]);
  const [errors, setErrors]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState("events");

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      callPortal(session, "get-security"),
      callPortal(session, "get-errors"),
    ]).then(([se, er]) => {
      setEvents(se.events);
      setErrors(er.errors);
    }).catch(console.error).finally(() => setLoading(false));
  }, [session]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (type, id) => {
    try {
      if (type === "event") await callPortal(session, "resolve-security", { event_id: id });
      else await callPortal(session, "resolve-error", { error_id: id });
      load();
    } catch (e) { alert(e.message); }
  };

  const severityType = (s) => ({ critical: "danger", high: "danger", medium: "warn", low: "info", info: "neutral" }[s] || "neutral");

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-slate-800">Security & Errors</h2>

      <div className="flex bg-white rounded-xl border border-slate-200 p-1 gap-1">
        {[["events", `Events (${events.filter(e => !e.resolved).length})`], ["errors", `Errors (${errors.filter(e => !e.resolved).length})`]].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${tab === k ? "bg-blue-600 text-white" : "text-slate-600"}`}
          >{label}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spin /></div>
      ) : tab === "events" ? (
        <div className="space-y-2">
          {events.map(ev => (
            <div key={ev.id} className={`bg-white rounded-xl p-4 border ${ev.resolved ? "border-slate-100 opacity-60" : "border-red-100"} shadow-sm`}>
              <div className="flex justify-between items-start">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge text={ev.severity || "medium"} type={severityType(ev.severity)} />
                    <p className="text-sm font-medium text-slate-800 truncate">{ev.event_type}</p>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{ev.description}</p>
                  <p className="text-xs text-slate-400 mt-1">{fmtDate(ev.created_at)}</p>
                </div>
                {!ev.resolved && (
                  <button
                    onClick={() => resolve("event", ev.id)}
                    className="ml-2 text-xs px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-medium flex-shrink-0"
                  >Resolve</button>
                )}
              </div>
            </div>
          ))}
          {events.length === 0 && <p className="text-center text-slate-400 py-8 text-sm">No security events.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {errors.map(er => (
            <div key={er.id} className={`bg-white rounded-xl p-4 border ${er.resolved ? "border-slate-100 opacity-60" : "border-amber-100"} shadow-sm`}>
              <div className="flex justify-between items-start">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge text={er.severity || "medium"} type={severityType(er.severity)} />
                    <p className="text-sm font-medium text-slate-800 truncate">{er.error_type}</p>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{er.message}</p>
                  <p className="text-xs text-slate-400 mt-1">{er.location} · {fmtDate(er.created_at)}</p>
                </div>
                {!er.resolved && (
                  <button
                    onClick={() => resolve("error", er.id)}
                    className="ml-2 text-xs px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-medium flex-shrink-0"
                  >Resolve</button>
                )}
              </div>
            </div>
          ))}
          {errors.length === 0 && <p className="text-center text-slate-400 py-8 text-sm">No system errors.</p>}
        </div>
      )}
    </div>
  );
}

// ── Audit Log Section ──────────────────────────────────────────────────────────
function AuditLog({ session }) {
  const [log, setLog]         = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    callPortal(session, "get-audit")
      .then(d => setLog(d.log))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-slate-800">Audit Log</h2>
      {loading ? (
        <div className="flex justify-center py-12"><Spin /></div>
      ) : (
        <div className="space-y-2">
          {log.map(entry => (
            <div key={entry.id} className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-slate-800">{entry.action}</p>
                  <p className="text-xs text-slate-500">by <span className="font-medium">{entry.admin_username}</span> · {entry.target_type || "—"}</p>
                  {entry.details && <p className="text-xs text-slate-400 mt-0.5">{entry.details}</p>}
                </div>
                <p className="text-xs text-slate-400 flex-shrink-0 ml-2">{fmtDate(entry.created_at)}</p>
              </div>
            </div>
          ))}
          {log.length === 0 && <p className="text-center text-slate-400 py-8 text-sm">No audit log entries.</p>}
        </div>
      )}
    </div>
  );
}

// ── Broadcasts Section ─────────────────────────────────────────────────────────
function Broadcasts({ session }) {
  const [broadcasts, setBroadcasts] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [form, setForm]             = useState({ title: "", message: "", segment: "all", channel: "in_app" });
  const [sending, setSending]       = useState(false);

  const load = () => {
    setLoading(true);
    callPortal(session, "get-broadcasts")
      .then(d => setBroadcasts(d.broadcasts))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [session]); // eslint-disable-line

  const send = async () => {
    if (!form.title || !form.message) return alert("Title and message required.");
    setSending(true);
    try {
      await callPortal(session, "send-broadcast", form);
      setShowForm(false);
      setForm({ title: "", message: "", segment: "all", channel: "in_app" });
      load();
    } catch (e) { alert(e.message); }
    finally { setSending(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">Broadcasts</h2>
        <button
          onClick={() => setShowForm(v => !v)}
          className="bg-blue-600 text-white px-3 py-1.5 rounded-xl text-xs font-medium hover:bg-blue-700"
        >+ New Broadcast</button>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl p-5 border border-blue-100 shadow-sm space-y-3">
          <input
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Title"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          />
          <textarea
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px] resize-none"
            placeholder="Message"
            value={form.message}
            onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
          />
          <div className="flex gap-2">
            <select
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none"
              value={form.segment}
              onChange={e => setForm(f => ({ ...f, segment: e.target.value }))}
            >
              <option value="all">All Users</option>
              <option value="basic">Basic Plan</option>
              <option value="professional">Pro Plan</option>
              <option value="enterprise">Enterprise</option>
            </select>
            <select
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none"
              value={form.channel}
              onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}
            >
              <option value="in_app">In-App</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </div>
          <button
            onClick={send}
            disabled={sending}
            className="w-full bg-blue-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >{sending ? "Sending…" : "Send Broadcast"}</button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Spin /></div>
      ) : (
        <div className="space-y-2">
          {broadcasts.map(b => (
            <div key={b.id} className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-slate-800 text-sm">{b.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{b.message}</p>
                </div>
                <Badge text={b.status} type={b.status === "sent" ? "success" : "warn"} />
              </div>
              <div className="flex gap-3 mt-2 text-xs text-slate-400">
                <span>Segment: {b.segment}</span>
                <span>Channel: {b.channel}</span>
                <span>{fmtDate(b.sent_at || b.created_at)}</span>
              </div>
            </div>
          ))}
          {broadcasts.length === 0 && <p className="text-center text-slate-400 py-8 text-sm">No broadcasts sent yet.</p>}
        </div>
      )}
    </div>
  );
}

// ── Admin Users Section ────────────────────────────────────────────────────────
function AdminUsers({ session, currentAdmin }) {
  const [admins, setAdmins]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]       = useState({ username: "", email: "", password: "", role: "support_admin", can_create_admins: "false" });
  const [saving, setSaving]   = useState(false);

  const load = () => {
    setLoading(true);
    callPortal(session, "get-admins")
      .then(d => setAdmins(d.admins))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [session]); // eslint-disable-line

  const create = async () => {
    if (!form.username || !form.password) return alert("Username and password required.");
    setSaving(true);
    try {
      await callPortal(session, "create-admin", form);
      setShowForm(false);
      setForm({ username: "", email: "", password: "", role: "support_admin", can_create_admins: "false" });
      load();
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const toggleStatus = async (id, current) => {
    try {
      await callPortal(session, "toggle-admin", { target_admin_id: id, is_active: !current });
      load();
    } catch (e) { alert(e.message); }
  };

  const roleBadge = (r) => {
    const m = { super_admin: "danger", finance_admin: "success", operations_admin: "info", support_admin: "neutral", marketing_admin: "warn", compliance_admin: "purple" };
    return <Badge text={r?.replace(/_/g, " ")} type={m[r] || "neutral"} />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">Admin Users</h2>
        {currentAdmin?.can_create_admins && (
          <button
            onClick={() => setShowForm(v => !v)}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-xl text-xs font-medium hover:bg-blue-700"
          >+ Add Admin</button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl p-5 border border-blue-100 shadow-sm space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Username"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
            />
            <input
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Email (optional)"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            />
          </div>
          <input
            type="password"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Password"
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
          />
          <div className="flex gap-2">
            <select
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none"
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            >
              <option value="support_admin">Support Admin</option>
              <option value="finance_admin">Finance Admin</option>
              <option value="operations_admin">Operations Admin</option>
              <option value="marketing_admin">Marketing Admin</option>
              <option value="compliance_admin">Compliance Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
            <select
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none"
              value={form.can_create_admins}
              onChange={e => setForm(f => ({ ...f, can_create_admins: e.target.value }))}
            >
              <option value="false">Cannot Create Admins</option>
              <option value="true">Can Create Admins</option>
            </select>
          </div>
          <button
            onClick={create}
            disabled={saving}
            className="w-full bg-blue-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >{saving ? "Creating…" : "Create Admin Account"}</button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Spin /></div>
      ) : (
        <div className="space-y-2">
          {admins.map(a => (
            <div key={a.id} className={`bg-white rounded-2xl p-4 border border-slate-100 shadow-sm ${!a.is_active ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-800 text-sm">{a.username}</p>
                    {roleBadge(a.role)}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{a.email || "No email"}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Last login: {fmtDate(a.last_login)} · Joined: {fmtDate(a.created_at)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge text={a.is_active ? "Active" : "Inactive"} type={a.is_active ? "success" : "neutral"} />
                  {a.can_create_admins && <Badge text="Can Add Admins" type="info" />}
                </div>
              </div>
              {currentAdmin?.can_create_admins && a.username !== "SuperAdmin" && (
                <button
                  onClick={() => toggleStatus(a.id, a.is_active)}
                  className={`mt-3 text-xs px-3 py-1.5 rounded-lg font-medium ${a.is_active ? "bg-amber-50 text-amber-700 hover:bg-amber-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                >{a.is_active ? "Deactivate" : "Reactivate"}</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Plans Manager ──────────────────────────────────────────────────────────────
const ALL_FEATURE_KEYS = [
  { key: "credit",          label: "Credit Management" },
  { key: "aso",             label: "Ajo/Savings Groups" },
  { key: "pdfExport",       label: "PDF Reports & Export" },
  { key: "staffManagement", label: "Staff Management" },
  { key: "inventory",       label: "Inventory Management" },
  { key: "loyalty",         label: "Loyalty Program" },
  { key: "aiInsights",      label: "AI Business Insights" },
  { key: "aiChatbot",       label: "AI Chatbot" },
  { key: "branches",        label: "Branch Management" },
  { key: "organisation",    label: "Organisation / Coop" },
  { key: "apiAccess",       label: "API Access" },
  { key: "loanAccess",      label: "Business Loan Access" },
  { key: "printWholesale",  label: "Print Wholesale (Airtime & Data)" },
];

// Features with a numeric cap — shown as an inline count input when enabled
const COUNTABLE_FEATURE_LABELS = {
  aso:             "Max groups",
  staffManagement: "Max staff",
  branches:        "Max branches",
  organisation:    "Max orgs",
  inventory:       "Max items",
  loyalty:         "Max members",
};

function PlansManager() {
  const [plans, setPlans]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [editing, setEditing]     = useState(null); // plan id being edited
  const [form, setForm]           = useState({});
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null); // { plan, subCount } | null
  const [deleting, setDeleting]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("subscription_plans")
      .select("*")
      .order("sort_order");
    setPlans(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (plan) => {
    setEditing(plan.id);
    setForm({
      name:              plan.name,
      description:       plan.description || "",
      price_monthly:     plan.price_monthly,
      price_yearly:      plan.price_yearly || 0,
      max_transactions:  plan.max_transactions,
      max_organizations: plan.max_organizations,
      max_org_members:   plan.max_org_members,
      max_ajo_groups:    plan.max_ajo_groups,
      sort_order:        plan.sort_order,
      is_active:         plan.is_active,
      feature_keys:      Array.isArray(plan.feature_keys) ? plan.feature_keys : [],
      feature_limits:    (plan.feature_limits && typeof plan.feature_limits === "object") ? plan.feature_limits : {},
      features:          Array.isArray(plan.features) ? plan.features.join("\n") : "",
    });
    setMsg("");
  };

  const toggleKey = (key) => {
    setForm(f => ({
      ...f,
      feature_keys: f.feature_keys.includes(key)
        ? f.feature_keys.filter(k => k !== key)
        : [...f.feature_keys, key],
    }));
  };

  const handleSave = async () => {
    setSaving(true); setMsg("");
    try {
      const payload = {
        name:              form.name,
        description:       form.description,
        price_monthly:     Number(form.price_monthly),
        price_yearly:      Number(form.price_yearly),
        max_transactions:  Number(form.max_transactions),
        max_organizations: Number(form.max_organizations),
        max_org_members:   Number(form.max_org_members),
        max_ajo_groups:    Number(form.max_ajo_groups),
        sort_order:        Number(form.sort_order),
        is_active:         form.is_active,
        feature_keys:      form.feature_keys,
        feature_limits:    form.feature_limits || {},
        features:          form.features.split("\n").map(s => s.trim()).filter(Boolean),
        updated_at:        new Date().toISOString(),
      };
      const { error } = await supabase.from("subscription_plans").update(payload).eq("id", editing);
      if (error) throw error;
      // Bust the client-side cache so next page load picks up changes
      try { localStorage.removeItem("kuditrack_plans_v2"); } catch {}
      setMsg("Saved successfully.");
      setEditing(null);
      load();
    } catch (e) {
      setMsg("Error: " + (e.message || "Could not save"));
    } finally {
      setSaving(false);
    }
  };

  const startDelete = async (plan) => {
    // Count active subscribers on this plan before confirming
    const { count } = await supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("plan", plan.slug)
      .eq("status", "active");
    setConfirmDelete({ plan, subCount: count || 0 });
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("subscription_plans")
        .delete()
        .eq("id", confirmDelete.plan.id);
      if (error) throw error;
      try { localStorage.removeItem("kuditrack_plans_v2"); } catch {}
      setConfirmDelete(null);
      load();
    } catch (e) {
      setConfirmDelete(prev => prev ? { ...prev, error: e.message } : null);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="py-10 text-center text-slate-400 text-sm">Loading plans…</div>;

  if (editing) {
    const f = form;
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => setEditing(null)} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
            ← Back
          </button>
          <h3 className="text-base font-bold text-slate-800">Edit Plan</h3>
        </div>

        {msg && <p className={`text-xs px-3 py-2 rounded-lg ${msg.startsWith("Error") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{msg}</p>}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Plan Name</label>
            <input value={f.name} onChange={e => setForm(x => ({...x, name: e.target.value}))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Sort Order</label>
            <input type="number" value={f.sort_order} onChange={e => setForm(x => ({...x, sort_order: e.target.value}))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Description</label>
          <input value={f.description} onChange={e => setForm(x => ({...x, description: e.target.value}))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Price/Month (₦)</label>
            <input type="number" value={f.price_monthly} onChange={e => setForm(x => ({...x, price_monthly: e.target.value}))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Price/Year (₦)</label>
            <input type="number" value={f.price_yearly} onChange={e => setForm(x => ({...x, price_yearly: e.target.value}))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {f.price_monthly > 0 && f.price_yearly > 0 && (
              <p className="text-[10px] text-green-600 mt-0.5">
                {Math.round((1 - f.price_yearly / (f.price_monthly * 12)) * 100)}% off yearly
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Max Transactions/mo</label>
            <input type="number" value={f.max_transactions} onChange={e => setForm(x => ({...x, max_transactions: e.target.value}))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Max Organisations</label>
            <input type="number" value={f.max_organizations} onChange={e => setForm(x => ({...x, max_organizations: e.target.value}))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Max Members/Org</label>
            <input type="number" value={f.max_org_members} onChange={e => setForm(x => ({...x, max_org_members: e.target.value}))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Max Ajo Groups</label>
            <input type="number" value={f.max_ajo_groups} onChange={e => setForm(x => ({...x, max_ajo_groups: e.target.value}))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-2">Features &amp; Limits</label>
          <div className="space-y-2">
            {ALL_FEATURE_KEYS.map(({ key, label }) => {
              const isOn = f.feature_keys.includes(key);
              const countLabel = COUNTABLE_FEATURE_LABELS[key];
              const limitVal = f.feature_limits?.[key];
              const displayVal = (limitVal === undefined || limitVal === null || Number(limitVal) >= 999999) ? "" : String(limitVal);
              return (
                <div key={key} className="flex items-center gap-2 min-h-[28px]">
                  <label className="flex items-center gap-2 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => toggleKey(key)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 shrink-0"
                    />
                    <span className="text-xs text-slate-700">{label}</span>
                  </label>
                  {countLabel && isOn && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">{countLabel}:</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="∞"
                        value={displayVal}
                        onChange={e => {
                          const v = e.target.value === "" ? 999999 : Math.max(0, Number(e.target.value));
                          setForm(x => ({ ...x, feature_limits: { ...x.feature_limits, [key]: v } }));
                        }}
                        className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400 mt-2">Leave count blank = unlimited. Changes take effect for all businesses on this plan immediately.</p>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Display Features (one per line)</label>
          <textarea
            value={f.features}
            onChange={e => setForm(x => ({...x, features: e.target.value}))}
            rows={6}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono"
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={f.is_active}
              onChange={e => setForm(x => ({...x, is_active: e.target.checked}))}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-slate-700 font-medium">Plan is active (visible to users)</span>
          </label>
        </div>

        <div className="flex gap-3">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors">
            {saving ? "Saving…" : "Save Changes"}
          </button>
          <button onClick={() => setEditing(null)}
            className="px-5 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-800">Subscription Plans</h3>
        <p className="text-xs text-slate-400">Changes take effect immediately for new subscribers</p>
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4">
            <h4 className="font-bold text-slate-800 text-base">Delete "{confirmDelete.plan.name}"?</h4>
            {confirmDelete.subCount > 0 ? (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                <strong>{confirmDelete.subCount} active subscriber{confirmDelete.subCount !== 1 ? "s" : ""}</strong> are currently on this plan. They will automatically fall back to the free plan.
              </div>
            ) : (
              <p className="text-sm text-slate-500">No active subscribers on this plan. It will be permanently removed.</p>
            )}
            {confirmDelete.error && (
              <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{confirmDelete.error}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors">
                {deleting ? "Deleting…" : "Yes, Delete"}
              </button>
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="px-5 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {plans.map(plan => (
        <div key={plan.id}
          className={`bg-white border rounded-2xl p-5 shadow-sm flex flex-col gap-3 ${plan.is_active ? "border-slate-200" : "border-dashed border-slate-300 opacity-60"}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-slate-800 text-sm">{plan.name}</h4>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${plan.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                  {plan.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{plan.description}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => startEdit(plan)}
                className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 font-semibold hover:bg-blue-100 transition-colors">
                Edit
              </button>
              <button onClick={() => startDelete(plan)}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600 font-semibold hover:bg-red-100 transition-colors">
                Delete
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="bg-slate-50 rounded-lg px-3 py-2">
              <p className="text-slate-400">Monthly</p>
              <p className="font-bold text-slate-800">{plan.price_monthly === 0 ? "Free" : `₦${plan.price_monthly.toLocaleString()}`}</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-3 py-2">
              <p className="text-slate-400">Yearly</p>
              <p className="font-bold text-slate-800">
                {plan.price_yearly ? `₦${plan.price_yearly.toLocaleString()}` : "—"}
                {plan.price_yearly > 0 && plan.price_monthly > 0 && (
                  <span className="text-green-600 ml-1">({Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100)}% off)</span>
                )}
              </p>
            </div>
          </div>

          {Array.isArray(plan.feature_keys) && plan.feature_keys.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {plan.feature_keys.map(k => (
                <span key={k} className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">{k}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Nav items ──────────────────────────────────────────────────────────────────
const NAV = [
  { id: "overview",   label: "Overview",       icon: "⊞" },
  { id: "users",      label: "Users",          icon: "👥" },
  { id: "finance",    label: "Finance",        icon: "💰" },
  { id: "orgs",       label: "Organisations",  icon: "🏛" },
  { id: "plans",      label: "Plans",          icon: "📦" },
  { id: "security",   label: "Security",       icon: "🔒" },
  { id: "audit",      label: "Audit Log",      icon: "📋" },
  { id: "broadcasts", label: "Broadcasts",     icon: "📢" },
  { id: "admins",     label: "Admin Users",    icon: "🛡" },
];

// ── Main Component ─────────────────────────────────────────────────────────────
export default function AdminDashboard({ session, adminUser }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [menuOpen, setMenuOpen]   = useState(false);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const content = {
    overview:   <Overview   session={session} />,
    users:      <Users      session={session} />,
    finance:    <Finance    session={session} />,
    orgs:       <Organisations session={session} />,
    plans:      <PlansManager />,
    security:   <Security   session={session} />,
    audit:      <AuditLog   session={session} />,
    broadcasts: <Broadcasts session={session} />,
    admins:     <AdminUsers session={session} currentAdmin={adminUser} />,
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Bar */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="md:hidden p-2 rounded-xl hover:bg-slate-100"
          >
            <span className="text-lg">☰</span>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-bold">K</span>
            </div>
            <span className="font-bold text-slate-800 text-sm">KudiTrack Admin</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-xs font-semibold text-slate-700">{adminUser?.username || "Admin"}</span>
            <span className="text-[10px] text-slate-400 capitalize">{adminUser?.role?.replace(/_/g, " ") || "Super Admin"}</span>
          </div>
          <button
            onClick={handleSignOut}
            className="text-xs px-3 py-1.5 rounded-xl bg-red-50 text-red-600 font-medium hover:bg-red-100"
          >Sign Out</button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (desktop) */}
        <aside className="hidden md:flex flex-col w-56 bg-white border-r border-slate-200 py-4 gap-1 px-2 flex-shrink-0">
          {NAV.map(n => (
            <button
              key={n.id}
              onClick={() => setActiveTab(n.id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                activeTab === n.id
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span className="text-base">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </aside>

        {/* Mobile slide-out menu */}
        {menuOpen && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMenuOpen(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <aside
              className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-2xl flex flex-col py-4 gap-1 px-2 pt-16"
              onClick={e => e.stopPropagation()}
            >
              {NAV.map(n => (
                <button
                  key={n.id}
                  onClick={() => { setActiveTab(n.id); setMenuOpen(false); }}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                    activeTab === n.id
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <span className="text-base">{n.icon}</span>
                  {n.label}
                </button>
              ))}
            </aside>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto overscroll-contain p-4 md:p-6 max-w-4xl">
          {content[activeTab]}
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden flex bg-white border-t border-slate-200 shadow-lg">
        {NAV.slice(0, 5).map(n => (
          <button
            key={n.id}
            onClick={() => setActiveTab(n.id)}
            className={`flex-1 flex flex-col items-center py-2 gap-0.5 text-[10px] font-medium transition-colors ${
              activeTab === n.id ? "text-blue-600" : "text-slate-400"
            }`}
          >
            <span className="text-base leading-none">{n.icon}</span>
            {n.label.split(" ")[0]}
          </button>
        ))}
        <button
          onClick={() => setActiveTab(NAV.find(n => n.id !== NAV.slice(0, 5).find(x => x.id === n.id)?.id && activeTab !== n.id)?.id || "admins")}
          className="flex-1 flex flex-col items-center py-2 gap-0.5 text-[10px] font-medium text-slate-400"
        >
          <span className="text-base leading-none">⋯</span>
          More
        </button>
      </nav>
    </div>
  );
}
