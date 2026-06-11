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

// ── Nav items ──────────────────────────────────────────────────────────────────
const NAV = [
  { id: "overview",   label: "Overview",       icon: "⊞" },
  { id: "users",      label: "Users",          icon: "👥" },
  { id: "finance",    label: "Finance",        icon: "💰" },
  { id: "orgs",       label: "Organisations",  icon: "🏛" },
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
        <main className="flex-1 overflow-y-auto p-4 md:p-6 max-w-4xl">
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
