import SITE from "../content/site.json";
import SiteShell, { useSeo, Phone, Icon3D, TiltCard, CtaBand } from "./SiteShell";

/** kudiai.app/about — the company: story, mission, vision, values, founder. */
const CSS = `
.ab-story{display:grid;gap:44px;align-items:center}
@media(min-width:940px){.ab-story{grid-template-columns:1.1fr .9fr;gap:80px}}
.ab-story p{font-size:17.5px;line-height:1.8;color:var(--text);margin:0 0 18px}
.ab-mv{display:grid;gap:18px}
@media(min-width:800px){.ab-mv{grid-template-columns:1fr 1fr}}
.ab-mv .ks-card{position:relative;padding:34px 30px;overflow:hidden;min-height:220px}
.ab-mv img{position:absolute;right:16px;bottom:12px;width:110px;height:auto;filter:drop-shadow(0 16px 20px rgba(15,23,42,.2))}
.ab-mv small{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--green)}
.ab-mv h3{font-size:clamp(20px,2.3vw,25px);line-height:1.35;color:var(--ink);margin:12px 0 0;max-width:78%;font-weight:800;letter-spacing:-.015em}
.ab-vals{display:grid;gap:14px}
@media(min-width:640px){.ab-vals{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1000px){.ab-vals{grid-template-columns:repeat(4,1fr)}}
.ab-vals .ks-card h3{margin:14px 0 6px;color:var(--ink);font-size:18px}.ab-vals .ks-card p{margin:0;color:var(--muted);font-size:15px;line-height:1.6}
.ab-num{width:42px;height:42px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;background:linear-gradient(150deg,#46b832,#2f8a1f)}
.ab-facts{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
@media(min-width:800px){.ab-facts{grid-template-columns:repeat(4,1fr)}}
.ab-fact{text-align:center;padding:26px 14px;border-radius:22px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12)}
.ab-fact b{display:block;font-size:clamp(34px,4.6vw,48px);font-weight:800;letter-spacing:-.03em;background:linear-gradient(90deg,#7ee06a,#E9B949);-webkit-background-clip:text;background-clip:text;color:transparent}
.ab-fact span{color:#aab6d6;font-size:14.5px;font-weight:600}
.ab-founder{display:grid;gap:28px;align-items:center;padding:28px}
@media(min-width:760px){.ab-founder{grid-template-columns:220px 1fr;gap:40px;padding:36px}}
.ab-founder img{width:100%;max-width:220px;aspect-ratio:4/5;object-fit:cover;object-position:50% 20%;border-radius:22px;box-shadow:0 26px 50px -24px rgba(15,23,42,.5)}
.ab-founder blockquote{margin:0 0 16px;font-size:clamp(19px,2.2vw,24px);line-height:1.45;color:var(--ink);font-weight:700;letter-spacing:-.01em}
`;

export default function AboutPage() {
  useSeo(SITE.seo.about);
  const A = SITE.about;
  return (
    <SiteShell page="about">
      <style>{CSS}</style>

      <section className="ks-dark ks-mesh ks-phero">
        <div className="ks-wrap">
          <div>
            <div className="ks-kicker ks-reveal">About us · Amaya &amp; Co. Technologies</div>
            <h1 className="ks-h1 ks-reveal d1">Built in Nigeria, for the businesses that <em>keep Nigeria moving.</em></h1>
            <p className="ks-reveal d2">{A.lead}</p>
          </div>
          <div className="ks-scene ks-heroart ks-reveal d2" aria-hidden="true">
            <Icon3D name="team" size={200} depth={-16} className="ks-float" style={{ left: "16%", top: "10px" }} />
            <Icon3D name="coins" size={120} depth={24} className="ks-float d2" style={{ right: "4%", top: "0" }} />
            <Icon3D name="chart" size={110} depth={18} className="ks-float d3" style={{ right: "10%", top: "160px" }} />
          </div>
        </div>
      </section>

      <section className="ks-sec">
        <div className="ks-wrap ab-story">
          <div className="ks-reveal">
            <div className="ks-eyebrow">Our story</div>
            <h2 className="ks-h2">It started with one question.</h2>
            {A.story.map((p) => <p key={p.slice(0, 20)}>{p}</p>)}
          </div>
          <div className="ks-scene ks-reveal d2" style={{ display: "flex", justifyContent: "center", minHeight: 440 }}>
            <div className="ks-par" style={{ "--d": "8px" }}>
              <Phone shot="dashboard" alt="The KudiAI Track dashboard" tilt="rotateY(-15deg) rotateX(5deg)" className="ks-float" />
            </div>
            <Icon3D name="wallet" size={120} depth={-18} className="ks-float d2" style={{ right: "4%", bottom: "30px" }} />
          </div>
        </div>
      </section>

      <section className="ks-sec" style={{ paddingTop: 0 }}>
        <div className="ks-wrap ab-mv">
          <TiltCard className="ks-card ks-reveal">
            <small>Our mission</small><h3>{A.mission}</h3>
            <img src="/site/3d/chart.webp" alt="" loading="lazy" />
          </TiltCard>
          <TiltCard className="ks-card ks-reveal d1" style={{ background: "linear-gradient(150deg,#0B1437,#16255A)", borderColor: "transparent" }}>
            <small style={{ color: "#7ee06a" }}>Our vision</small><h3 style={{ color: "#fff" }}>{A.vision}</h3>
            <img src="/site/3d/coins.webp" alt="" loading="lazy" />
          </TiltCard>
        </div>
      </section>

      <section className="ks-sec" style={{ paddingTop: 0 }}>
        <div className="ks-wrap">
          <div className="ks-center ks-reveal">
            <div className="ks-eyebrow">What we believe</div>
            <h2 className="ks-h2">Our values.</h2>
          </div>
          <div className="ab-vals" style={{ marginTop: 30 }}>
            {A.values.map(([t, d], i) => (
              <TiltCard className={`ks-card ks-reveal d${(i % 3) + 1}`} key={t}><div className="ab-num">{i + 1}</div><h3>{t}</h3><p>{d}</p></TiltCard>
            ))}
          </div>
        </div>
      </section>

      <section className="ks-sec ks-dark ks-mesh">
        <div className="ks-wrap">
          <div className="ks-center ks-reveal">
            <div className="ks-eyebrow" style={{ color: "#7ee06a" }}>KudiAI Track today</div>
            <h2 className="ks-h2">One app. Everything counted.</h2>
          </div>
          <div className="ab-facts ks-reveal d1" style={{ marginTop: 30 }}>
            {A.facts.map(([n, l]) => <div className="ab-fact" key={l}><b>{n}</b><span>{l}</span></div>)}
          </div>
        </div>
      </section>

      <section className="ks-sec">
        <div className="ks-wrap" style={{ maxWidth: 980 }}>
          <div className="ks-card ab-founder ks-reveal">
            <img src="/people/solomon-leon-johnson.jpg" alt="Solomon Leon Johnson, Founder & CEO of Amaya & Co. Technologies" loading="lazy" />
            <div>
              <div className="ks-eyebrow">Our founder</div>
              <blockquote>“Nigerian youth are moving from learning to earning, from seeking validation to owning validation, from requesting a seat at the table to owning the table.”</blockquote>
              <p style={{ margin: "0 0 18px", color: "var(--muted)" }}><b style={{ color: "var(--ink)" }}>Solomon Leon Johnson</b> · Founder &amp; CEO, Amaya Technologies</p>
              <a className="ks-btn line" href="/founder">Read the founder’s note →</a>
            </div>
          </div>
        </div>
      </section>

      <CtaBand />
    </SiteShell>
  );
}
