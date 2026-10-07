import { useMemo, useState } from "react";
import SITE from "../content/site.json";
import SiteShell, { useSeo, Icon3D, CtaBand, Faq } from "./SiteShell";

/** kudiai.app/faq — product questions by topic, with search. */
const CSS = `
.fq-tools{display:grid;gap:14px;margin:-36px auto 0;max-width:880px;position:relative;z-index:2}
.fq-search{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:0 18px;box-shadow:0 24px 50px -30px rgba(15,23,42,.45)}
.fq-search input{flex:1;border:0;background:transparent;font:inherit;font-size:16px;color:var(--ink);padding:18px 0;outline:none}
.fq-cats{display:flex;gap:8px;flex-wrap:wrap}
.fq-cats button{font:inherit;font-weight:700;font-size:14px;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.fq-cats button[aria-pressed="true"]{background:var(--green);border-color:var(--green);color:#fff}
.fq-group{margin-top:40px}
.fq-group h2{font-size:20px;color:var(--ink);margin:0 0 14px;display:flex;align-items:center;gap:10px}
.fq-group h2:before{content:"";width:10px;height:10px;border-radius:3px;background:var(--green)}
`;

export default function FaqPage() {
  useSeo(SITE.seo.faq);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SITE.faq
      .filter((g) => cat === "All" || g.cat === cat)
      .map((g) => ({ ...g, items: needle ? g.items.filter(([a, b]) => (a + " " + b).toLowerCase().includes(needle)) : g.items }))
      .filter((g) => g.items.length);
  }, [q, cat]);
  return (
    <SiteShell page="faq">
      <style>{CSS}</style>
      <section className="ks-dark ks-mesh ks-phero" style={{ paddingBottom: 96 }}>
        <div className="ks-wrap">
          <div>
            <h1 className="ks-h1 ks-reveal d1">Frequently asked <em>questions.</em></h1>
            <p className="ks-reveal d2">Everything about recording sales, the wallet, bill payments, Ajo and Esusu savings, staff and security.</p>
          </div>
          <div className="ks-scene ks-heroart ks-reveal d2" aria-hidden="true">
            <Icon3D name="ai" size={190} depth={-18} className="ks-float" style={{ left: "18%", top: "10px" }} />
            <Icon3D name="shield" size={110} depth={22} className="ks-float d2" style={{ right: "6%", top: "130px" }} />
          </div>
        </div>
      </section>

      <section className="ks-wrap" style={{ paddingBottom: 80 }}>
        <div className="fq-tools">
          <label className="fq-search">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" style={{ color: "var(--muted)" }}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions, e.g. wallet, invoice, esusu" aria-label="Search the FAQ" />
          </label>
          <div className="fq-cats" role="group" aria-label="Topics">
            {["All", ...SITE.faq.map((g) => g.cat)].map((c) => <button type="button" key={c} aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
          </div>
        </div>
        <div style={{ maxWidth: 880, margin: "0 auto" }}>
          {groups.length ? groups.map((g) => (
            <div className="fq-group" key={g.cat}><h2>{g.cat}</h2><Faq items={g.items} openFirst={false} /></div>
          )) : (
            <p style={{ textAlign: "center", marginTop: 48, color: "var(--muted)" }}>
              No questions match “{q}”. Try another word, or <a href="/contact" style={{ color: "var(--green)", fontWeight: 700 }}>contact us</a>.
            </p>
          )}
        </div>
      </section>

      <CtaBand title="Still have a question?" text="Email support@kudiai.app or message us on social media. We are happy to help." />
    </SiteShell>
  );
}
