import { useEffect, useMemo, useState } from "react";
import BLOG from "../content/blog/index.json";
import SiteShell, { useSeo, CtaBand } from "./SiteShell";

/** kudiai.app/blog — Blog & Insights: practical guides and market insights for Nigerian small businesses. */
export const BLOG_CSS = `
.bl-grid{display:grid;gap:22px}
@media(min-width:640px){.bl-grid{grid-template-columns:1fr 1fr}}
@media(min-width:1000px){.bl-grid{grid-template-columns:1fr 1fr 1fr}}
.bl-card{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:22px;overflow:hidden;text-decoration:none;color:inherit;transition:transform .25s,box-shadow .25s,border-color .25s}
.bl-card:hover{transform:translateY(-4px);box-shadow:0 30px 60px -34px rgba(15,23,42,.45);border-color:rgba(61,168,41,.4)}
.bl-card img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;background:#e2e8f0}
.bl-card .in{padding:18px 20px 22px;display:flex;flex-direction:column;gap:8px;flex:1}
.bl-card h3{font-size:19px;line-height:1.3;font-weight:800;letter-spacing:-.01em;color:var(--ink);margin:2px 0 0}
.bl-card p{margin:0;font-size:15px;line-height:1.6;color:var(--muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.bl-card .ft{margin-top:auto;padding-top:6px;font-size:13px;font-weight:600;color:var(--muted)}
.bl-tag{display:flex;gap:10px;align-items:center;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.bl-tag b{color:var(--green)}
.bl-tag span{color:var(--muted);font-weight:700;letter-spacing:.02em;text-transform:none;font-size:13px}
`;

const CSS = `
.bl-tools{display:flex;gap:8px;flex-wrap:wrap;margin:-30px 0 30px;position:relative;z-index:2}
.bl-tools button{font:inherit;font-weight:700;font-size:14.5px;padding:10px 18px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;box-shadow:0 14px 30px -24px rgba(15,23,42,.6)}
.bl-tools button[aria-pressed="true"]{background:var(--green);border-color:var(--green);color:#fff}
.bl-feat{display:grid;background:var(--card);border:1px solid var(--line);border-radius:26px;overflow:hidden;text-decoration:none;color:inherit;margin-bottom:26px;transition:box-shadow .25s,border-color .25s}
.bl-feat:hover{box-shadow:0 34px 70px -38px rgba(15,23,42,.5);border-color:rgba(61,168,41,.4)}
@media(min-width:900px){.bl-feat{grid-template-columns:1.15fr 1fr}}
.bl-feat img{display:block;width:100%;height:100%;min-height:220px;aspect-ratio:16/9;object-fit:cover;background:#e2e8f0}
.bl-feat .in{padding:24px 22px 28px;display:flex;flex-direction:column;justify-content:center;gap:12px}
@media(min-width:900px){.bl-feat .in{padding:40px}}
.bl-feat h2{font-size:clamp(24px,2.8vw,32px);line-height:1.15;font-weight:800;letter-spacing:-.02em;color:var(--ink);margin:0}
.bl-feat p{margin:0;font-size:16.5px;line-height:1.65;color:var(--muted)}
.bl-feat .go{font-weight:800;color:var(--green)}
`;

const CATS = ["All", "Guides", "Insights"];

/** "2026-10-07T12:00:00+01:00" → "7 October 2026" (Lagos time). */
export function longDate(iso) {
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }); } catch { return ""; }
}

export function PostCard({ p }) {
  return (
    <a className="bl-card" href={`/blog/${p.slug}`}>
      <img src={p.image} alt={p.imageAlt} width="1600" height="900" loading="lazy" decoding="async" />
      <div className="in">
        <div className="bl-tag"><b>{p.category}</b><span>{p.readMinutes} min read</span></div>
        <h3>{p.title}</h3>
        <p>{p.description}</p>
        <div className="ft">{longDate(p.date)}</div>
      </div>
    </a>
  );
}

const startCat = () => {
  if (typeof window === "undefined") return "All";
  const c = new URLSearchParams(window.location.search).get("category");
  return CATS.includes(c) ? c : "All";
};

export default function BlogPage() {
  useSeo(BLOG.seo);
  const [cat, setCat] = useState(startCat);
  useEffect(() => {
    const url = cat === "All" ? "/blog" : `/blog?category=${cat}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(window.history.state, "", url);
  }, [cat]);
  const posts = useMemo(() => {
    const list = [...BLOG.posts].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || String(b.date).localeCompare(String(a.date)));
    return cat === "All" ? list : list.filter((p) => p.category === cat);
  }, [cat]);
  const [lead, ...rest] = posts;

  return (
    <SiteShell page="blog">
      <style>{BLOG_CSS + CSS}</style>
      <section className="ks-dark ks-mesh ks-phero" style={{ paddingBottom: 88 }}>
        <div className="ks-wrap" style={{ display: "block" }}>
          <h1 className="ks-h1 ks-reveal d1">Blog &amp; <em>Insights.</em></h1>
          <p className="ks-reveal d2">{BLOG.intro}</p>
        </div>
      </section>

      <section className="ks-wrap" style={{ paddingBottom: 84 }}>
        <div className="bl-tools" role="group" aria-label="Show">
          {CATS.map((c) => <button type="button" key={c} aria-pressed={cat === c} onClick={() => setCat(c)}>{c === "All" ? "All articles" : c}</button>)}
        </div>
        {lead && (
          <a className="bl-feat" href={`/blog/${lead.slug}`}>
            <img src={lead.image} alt={lead.imageAlt} width="1600" height="900" fetchpriority="high" decoding="async" />
            <div className="in">
              <div className="bl-tag"><b>{lead.category}</b><span>{lead.readMinutes} min read · {longDate(lead.date)}</span></div>
              <h2>{lead.title}</h2>
              <p>{lead.description}</p>
              <span className="go">Read the article →</span>
            </div>
          </a>
        )}
        <div className="bl-grid">{rest.map((p) => <PostCard key={p.slug} p={p} />)}</div>
      </section>

      <CtaBand title="Know your numbers every day." text="KudiAI Track records your sales and expenses and shows today's real profit. Start free at kudiai.app." />
    </SiteShell>
  );
}
