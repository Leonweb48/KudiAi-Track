import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";
import { canSellPlans } from "../utils/platform";
import { useT } from "../contexts/LanguageContext";
import { Browser } from "@capacitor/browser";

const SITE = "https://kudiai.app";
const DAY = 864e5;
const fmtDate = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Owner banner while a paid plan is about to end (≤ 3 days) or has ended and is in its 3-day grace (server:
 * subscription_expiry_sweep, then the account moves to Free). Plans don't renew by themselves. In the Android app plans
 * can't be bought (Play rules) — the button sends the owner to kudiai.app instead.
 */
export default function PlanEndBanner({ userId, plan, onRenew }) {
  const t = useT();
  const [sub, setSub] = useState(null);

  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    Promise.resolve(
      supabase.from("subscriptions").select("plan, expires_at, grace_until, cancel_at_period_end")
        .eq("user_id", userId).eq("status", "active").maybeSingle(),
    ).then(async ({ data }) => {
      if (!live || !data?.expires_at) { if (live) setSub(null); return; }
      const { data: p } = await supabase.from("subscription_plans").select("name, price_monthly").eq("slug", data.plan).maybeSingle();
      if (live && Number(p?.price_monthly || 0) > 0) setSub({ ...data, planName: p?.name || data.plan });
    }).catch(() => {});
    return () => { live = false; };
  }, [userId, plan]);

  if (!sub) return null;
  const now = Date.now();
  const ends = new Date(sub.expires_at).getTime();
  const ended = ends <= now;
  if (!ended && ends - now > 3 * DAY) return null;
  if (ended && sub.cancel_at_period_end) return null;   // cancelled: moves to Free at the end date, nothing to nag about

  const text = ended
    ? t("planend.ended", { plan: sub.planName, date: fmtDate(sub.grace_until || ends + 3 * DAY) })
    : t("planend.endsSoon", { plan: sub.planName, date: fmtDate(ends) });
  const web = !canSellPlans();
  const renew = () => {
    if (!web) { onRenew?.(); return; }
    Promise.resolve(Browser.open({ url: SITE })).catch(() => { try { window.open(SITE, "_blank", "noopener"); } catch { /* ignore */ } });
  };

  return (
    <div role="status" className={`flex items-center gap-3 px-4 py-2.5 text-[13px] font-semibold ${ended ? "bg-red-600 text-white" : "bg-amber-400 text-amber-950"}`}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
      </svg>
      <span className="flex-1 leading-snug">{text}</span>
      <button onClick={renew}
        className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-extrabold ${ended ? "bg-white text-red-700" : "bg-amber-950 text-amber-50"} active:scale-95 transition`}>
        {web ? t("planend.renewWeb") : t("planend.renew")}
      </button>
    </div>
  );
}
