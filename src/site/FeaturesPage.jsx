import F from "../content/features.json";
import SITE from "../content/site.json";
import SiteShell, { useSeo, Phone, Icon3D, TiltCard, CtaBand, Faq } from "./SiteShell";

/** kudiai.app/features — every feature, with real app screens. Content: src/content/features.json. */
const ICON = { sales: "chart", stock: "boxes", credit: "invoice", wallet: "wallet", bills: "bills", ajo: "pot", savers: "coins", trust: "shield" };
const EXTRA_ICON = ["invoice", "ai", "ai", "team", "team", "pot"];

const CSS = `
.ft-chips{position:sticky;top:66px;z-index:20;background:rgba(246,248,251,.9);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.dark .ft-chips{background:rgba(7,11,26,.88)}
.ft-chips .ks-wrap{display:flex;gap:8px;overflow-x:auto;padding-top:12px;padding-bottom:12px;scrollbar-width:none}
.ft-chips .ks-wrap::-webkit-scrollbar{display:none}
.ft-chips a{flex:none;text-decoration:none;font-weight:700;font-size:14px;color:var(--ink) !important;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:var(--card)}
.ft-chips a:hover{border-color:var(--green);color:var(--green) !important}
.ft-row{display:grid;gap:40px;align-items:center;padding:64px 0;scroll-margin-top:130px}
.ft-row+.ft-row{border-top:1px solid var(--line)}
@media(min-width:940px){.ft-row{grid-template-columns:1fr 1fr;gap:80px;padding:88px 0}.ft-row.flip .ft-art{order:-1}}
.ft-badge{display:inline-flex;align-items:center;gap:10px;margin-bottom:14px}
.ft-badge img{width:58px;height:auto;filter:drop-shadow(0 10px 14px rgba(15,23,42,.2))}
.ft-badge span{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--green)}
.ft-items{list-style:none;padding:0;margin:22px 0 0;display:grid;gap:16px}
.ft-items li{display:grid;grid-template-columns:30px 1fr;gap:12px}
.ft-items li i{width:30px;height:30px;border-radius:10px;background:var(--soft);display:flex;align-items:center;justify-content:center}
.ft-items b{display:block;color:var(--ink);font-size:16.5px;margin-bottom:2px}
.ft-items span{color:var(--muted);font-size:15.5px;line-height:1.6}
.ft-art{position:relative;display:flex;justify-content:center;min-height:420px}
.ft-art .halo{position:absolute;inset:8% 10%;border-radius:40px;background:radial-gradient(60% 60% at 50% 45%,rgba(61,168,41,.22),transparent 70%),radial-gradient(50% 50% at 70% 70%,rgba(42,75,176,.18),transparent 70%);filter:blur(10px)}
.ft-extras{display:grid;gap:16px}
@media(min-width:640px){.ft-extras{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1000px){.ft-extras{grid-template-columns:repeat(3,1fr)}}
.ft-ex{position:relative;padding:26px 26px 24px;overflow:hidden}
.ft-ex img{width:84px;height:auto;margin-bottom:10px;filter:drop-shadow(0 12px 16px rgba(15,23,42,.18))}
.ft-ex h3{margin:0 0 6px;color:var(--ink);font-size:18px}.ft-ex p{margin:0;color:var(--muted);font-size:15px;line-height:1.6}
`;

const Tick = () => (
  <i aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3DA829" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 12.5 4 4 8-9" /></svg></i>
);

export default function FeaturesPage() {
  useSeo(F.seo);
  const faq = SITE.faq.flatMap((c) => c.items).slice(0, 8);
  return (
    <SiteShell page="features">
      <style>{CSS}</style>

      <section className="ks-dark ks-mesh ks-phero">
        <div className="ks-wrap">
          <div>
            <div className="ks-kicker ks-reveal">{F.hero.kicker}</div>
            <h1 className="ks-h1 ks-reveal d1">Run your whole business <em>from your phone.</em></h1>
            <p className="ks-reveal d2">{F.hero.lead}</p>
            <div className="ks-chips ks-reveal d3" style={{ marginTop: 24 }}>{F.hero.chips.map((c) => <span key={c}>{c}</span>)}</div>
          </div>
          <div className="ks-scene ks-heroart ks-reveal d2" aria-hidden="true">
            <Icon3D name="wallet" size={150} depth={-18} className="ks-float" style={{ left: "6%", top: "10px" }} />
            <Icon3D name="chart" size={130} depth={22} className="ks-float d2" style={{ right: "4%", top: "0" }} />
            <Icon3D name="pot" size={120} depth={14} className="ks-float d3" style={{ left: "34%", top: "110px" }} />
            <Icon3D name="shield" size={110} depth={-24} className="ks-float" style={{ right: "18%", top: "150px" }} />
          </div>
        </div>
      </section>

      <nav className="ft-chips" aria-label="Feature sections">
        <div className="ks-wrap">
          {F.groups.map((g) => <a key={g.id} href={`#${g.id}`}>{g.title}</a>)}
          <a href="#more">And more</a><a href="#faq">FAQ</a>
        </div>
      </nav>

      <section className="ks-wrap">
        {F.groups.map((g, i) => (
          <div className={`ft-row${i % 2 ? " flip" : ""}`} id={g.id} key={g.id}>
            <div className="ks-reveal">
              <div className="ft-badge"><img src={`/site/3d/${ICON[g.id]}.webp`} alt="" loading="lazy" /><span>{String(i + 1).padStart(2, "0")} · Feature</span></div>
              <h2 className="ks-h2">{g.title}</h2>
              <p className="ks-sub" style={{ marginBottom: 0 }}>{g.intro}</p>
              <ul className="ft-items">
                {g.items.map(([t, d]) => <li key={t}><Tick /><div><b>{t}</b><span>{d}</span></div></li>)}
              </ul>
            </div>
            <div className="ft-art ks-scene ks-reveal d2">
              <div className="halo" />
              <div className="ks-par" style={{ "--d": "8px" }}>
                <Phone shot={g.shot} alt={`${g.title} in KudiAI Track`} tilt={i % 2 ? "rotateY(16deg) rotateX(5deg)" : "rotateY(-16deg) rotateX(5deg)"} className="ks-float" />
              </div>
              <Icon3D name={ICON[g.id]} size={120} depth={-20} className="ks-float d2" style={i % 2 ? { left: "2%", bottom: "30px" } : { right: "2%", bottom: "30px" }} />
            </div>
          </div>
        ))}
      </section>

      <section className="ks-sec" id="more" style={{ scrollMarginTop: 130 }}>
        <div className="ks-wrap">
          <div className="ks-center ks-reveal">
            <div className="ks-eyebrow">And more</div>
            <h2 className="ks-h2">Built to grow with you.</h2>
          </div>
          <div className="ft-extras" style={{ marginTop: 32 }}>
            {F.extras.map((x, i) => (
              <TiltCard className={`ks-card ft-ex ks-reveal d${(i % 3) + 1}`} key={x.title}>
                <img src={`/site/3d/${EXTRA_ICON[i] || "chart"}.webp`} alt="" loading="lazy" />
                <h3>{x.title}</h3><p>{x.text}</p>
              </TiltCard>
            ))}
          </div>
        </div>
      </section>

      <section className="ks-sec" id="faq" style={{ paddingTop: 0, scrollMarginTop: 130 }}>
        <div className="ks-wrap" style={{ maxWidth: 880 }}>
          <div className="ks-center ks-reveal">
            <div className="ks-eyebrow">FAQ</div>
            <h2 className="ks-h2">Questions about the features.</h2>
          </div>
          <div className="ks-reveal d1" style={{ marginTop: 28 }}><Faq items={faq} /></div>
          <div className="ks-center" style={{ marginTop: 24 }}><a className="ks-btn line" href="/faq">See all questions →</a></div>
        </div>
      </section>

      <CtaBand />
    </SiteShell>
  );
}
