import SITE from "../content/site.json";
import F from "../content/features.json";
import SiteShell, { useSeo, SIGNUP, Phone, Icon3D, AreaChart, Bars, Ring, TiltCard, CtaBand, Faq } from "./SiteShell";

/** kudiai.app/home — the public homepage. */
const CSS = `
.hm-hero{padding:56px 0 40px}
@media(min-width:1000px){.hm-hero{padding:84px 0 70px}}
.hm-hero .ks-wrap{display:grid;gap:44px;align-items:center}
@media(min-width:1000px){.hm-hero .ks-wrap{grid-template-columns:1.05fr .95fr}}
.hm-lead{font-size:clamp(16.5px,1.8vw,19.5px);line-height:1.65;color:#b3c0e0;margin:0 0 28px;max-width:600px}
.hm-ctas{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:26px}
.hm-scene{height:470px;max-width:560px;margin:0 auto;width:100%}
@media(min-width:600px){.hm-scene{height:540px}}
.hm-scene .p1{position:absolute;left:4%;top:20px;z-index:2}
.hm-scene .p2{position:absolute;right:2%;top:70px;z-index:1;width:min(210px,48vw)}
.hm-scene .g1{left:-2%;top:300px;z-index:4}
.hm-scene .g2{right:-2%;top:12px;z-index:4}
.hm-scene .g3{right:6%;bottom:6px;z-index:4;display:flex;align-items:center;gap:12px}
@media(max-width:599px){.hm-scene{height:430px}.hm-scene .p1{left:2%;width:58vw}.hm-scene .p2{width:44vw;right:0;top:56px}.hm-scene .g1,.hm-scene .hm-chart3d,.hm-scene .hm-wallet3d{display:none}.hm-scene .g2{right:0;top:0;min-width:0}.hm-scene .g3{right:0;bottom:4px;min-width:0}}
.hm-pot{width:170px}@media(max-width:599px){.hm-pot{width:104px !important;top:10px !important}}
.hm-marq{background:#0d1840;border-top:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06);overflow:hidden;padding:16px 0;position:relative}
.hm-marq:before,.hm-marq:after{content:"";position:absolute;top:0;bottom:0;width:80px;z-index:1;pointer-events:none}
.hm-marq:before{left:0;background:linear-gradient(90deg,#0d1840,transparent)}.hm-marq:after{right:0;background:linear-gradient(-90deg,#0d1840,transparent)}
.ks-marq-in{display:flex;gap:12px;width:max-content;animation:hmMarq 38s linear infinite}
.hm-marq:hover .ks-marq-in{animation-play-state:paused}
.ks-marq-in span{color:#c9d4f0;font-weight:700;font-size:14px;padding:8px 16px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);white-space:nowrap}
@keyframes hmMarq{to{transform:translateX(-50%)}}
.hm-bento{display:grid;gap:16px}
@media(min-width:640px){.hm-bento{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1000px){.hm-bento{grid-template-columns:repeat(3,1fr)}}
.hm-bcard{position:relative;display:block;text-decoration:none;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:24px 24px 26px;min-height:230px;overflow:hidden}
.hm-bcard:before{content:"";position:absolute;inset:auto -40% -60% auto;width:260px;height:260px;border-radius:50%;background:radial-gradient(closest-side,rgba(61,168,41,.14),transparent);pointer-events:none}
.hm-bcard img{position:absolute;right:10px;top:10px;width:116px;height:auto;filter:drop-shadow(0 18px 22px rgba(15,23,42,.22));transform:translateZ(40px)}
.hm-bcard h3{font-size:19px;font-weight:800;color:var(--ink);margin:96px 0 8px;letter-spacing:-.01em;max-width:70%}
.hm-bcard p{margin:0;color:var(--muted);font-size:15px;line-height:1.6}
.hm-bcard .go{display:inline-flex;margin-top:14px;font-weight:700;font-size:14px;color:var(--green)}
.hm-bcard.big{background:linear-gradient(150deg,#0B1437,#16255A);border-color:transparent}
.hm-bcard.big h3{color:#fff}.hm-bcard.big p{color:#aab6d6}
@media(min-width:1000px){.hm-bcard.big{grid-row:span 2}.hm-bcard.big img{width:190px;right:14px;top:auto;bottom:18px}.hm-bcard.big h3{margin-top:10px;font-size:26px;max-width:100%}}
.hm-split{display:grid;gap:44px;align-items:center}
@media(min-width:960px){.hm-split{grid-template-columns:1fr 1fr;gap:72px}.hm-split.flip>:first-child{order:2}}
.hm-list{list-style:none;padding:0;margin:0;display:grid;gap:12px}
.hm-list li{display:flex;gap:12px;align-items:flex-start;font-weight:600;color:var(--ink);font-size:16px}
.hm-list li:before{content:"";flex:none;width:22px;height:22px;margin-top:1px;border-radius:50%;background:var(--soft) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%233DA829' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 12.5 4 4 8-9'/%3E%3C/svg%3E") center/13px no-repeat}
.hm-dash{position:relative;border-radius:28px;padding:22px;background:linear-gradient(160deg,#0B1437,#16255A);color:#fff;box-shadow:0 40px 80px -40px rgba(11,20,55,.7)}
.hm-dash .row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
.hm-tile{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:14px}
.hm-tile small{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9fb0d9}
.hm-tile b{display:block;font-size:22px;margin-top:2px}
.hm-tile .up{color:#7ee06a;font-size:12px;font-weight:700}
.hm-flow{display:grid;gap:18px;align-items:center}
@media(min-width:900px){.hm-flow{grid-template-columns:1fr auto 1.1fr auto 1fr}}
.hm-node{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:16px 18px;color:#e2e8f0;display:flex;gap:12px;align-items:center}
.hm-node img{width:46px;height:auto;filter:drop-shadow(0 8px 10px rgba(0,0,0,.4))}
.hm-node b{display:block;color:#fff}.hm-node span{font-size:13.5px;color:#aab6d6}
.hm-hub{text-align:center;padding:24px;border-radius:26px;background:linear-gradient(160deg,rgba(61,168,41,.25),rgba(42,75,176,.25));border:1px solid rgba(255,255,255,.2);box-shadow:0 0 60px -10px rgba(61,168,41,.45)}
.hm-hub img{width:120px;height:auto;filter:drop-shadow(0 20px 26px rgba(0,0,0,.45))}
.hm-hub b{display:block;color:#fff;font-size:20px;margin-top:6px}.hm-hub span{color:#aab6d6;font-size:14px}
.ks-flowline{height:4px;min-width:40px;border-radius:4px;background:repeating-linear-gradient(90deg,#5ED24A 0 10px,transparent 10px 20px);background-size:40px 4px;animation:hmFlow 1.2s linear infinite;opacity:.8}
@media(max-width:899px){.ks-flowline{width:4px;height:40px;min-width:0;margin:0 auto;background:repeating-linear-gradient(180deg,#5ED24A 0 10px,transparent 10px 20px);background-size:4px 40px;animation-name:hmFlowV}}
@keyframes hmFlow{to{background-position:40px 0}}@keyframes hmFlowV{to{background-position:0 40px}}
.hm-col{display:grid;gap:12px}
.hm-sec3{display:grid;gap:14px}
@media(min-width:700px){.hm-sec3{grid-template-columns:repeat(2,1fr)}}
.hm-sitem{display:flex;gap:14px;padding:20px;border-radius:20px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1)}
.hm-sitem i{flex:none;width:40px;height:40px;border-radius:12px;background:rgba(94,210,74,.15);display:flex;align-items:center;justify-content:center;color:#7ee06a;font-style:normal;font-weight:800}
.hm-sitem b{display:block;color:#fff;margin-bottom:3px}.hm-sitem span{color:#aab6d6;font-size:15px;line-height:1.55}
.hm-aud{display:grid;gap:14px}
@media(min-width:700px){.hm-aud{grid-template-columns:repeat(3,1fr)}}
.hm-steps{display:grid;gap:16px;position:relative}
@media(min-width:860px){.hm-steps{grid-template-columns:repeat(3,1fr)}.hm-steps:before{content:"";position:absolute;top:34px;left:12%;right:12%;height:2px;background:repeating-linear-gradient(90deg,var(--line) 0 8px,transparent 8px 16px)}}
.hm-step{position:relative;text-align:center;padding:0 10px}
.hm-step .n{width:68px;height:68px;margin:0 auto 16px;border-radius:22px;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;color:#fff;background:linear-gradient(150deg,#46b832,#2f8a1f);box-shadow:0 16px 30px -12px rgba(61,168,41,.8);position:relative}
.hm-step h3{color:var(--ink);margin:0 0 6px;font-size:18px}.hm-step p{margin:0;color:var(--muted);font-size:15px;line-height:1.6}
`;

export default function HomePage() {
  useSeo(SITE.seo.home);
  const H = SITE.home;
  const faq = SITE.faq.flatMap((c) => c.items).filter(([q]) => [
    "What is KudiAI Track?", "Is KudiAI Track free?", "How do customers pay into my wallet?", "Which bills can I pay?", "How does a savings card work?", "How is my money protected?",
  ].includes(q));
  return (
    <SiteShell page="home">
      <style>{CSS}</style>

      <section className="ks-dark ks-mesh hm-hero">
        <div className="ks-wrap">
          <div>
            <h1 className="ks-h1 ks-reveal d1">The money app built for <em>Nigerian businesses.</em></h1>
            <p className="hm-lead ks-reveal d2">{H.lead}</p>
            <div className="hm-ctas ks-reveal d3">
              <a className="ks-btn" href={SIGNUP}>Get started free →</a>
              <a className="ks-btn ghost" href="/features">Explore features</a>
            </div>
            <div className="ks-chips ks-reveal d3">{H.chips.map((c) => <span key={c}>{c}</span>)}</div>
          </div>

          <div className="ks-scene hm-scene ks-reveal d2" aria-hidden="true">
            <Icon3D name="coins" size={150} depth={-26} style={{ left: "38%", top: "-30px", zIndex: 0 }} className="ks-float" />
            <Icon3D name="chart" size={130} depth={18} style={{ left: "-6%", top: "150px", zIndex: 3 }} className="ks-float d3 hm-chart3d" />
            <div className="p1 ks-par" style={{ "--d": "10px" }}>
              <Phone shot="dashboard" alt="" tilt="rotateY(18deg) rotateX(6deg) rotateZ(-2deg)" eager className="ks-float" />
            </div>
            <div className="p2 ks-par" style={{ "--d": "-14px" }}>
              <Phone shot="savings-card" alt="" tilt="rotateY(-20deg) rotateX(6deg) rotateZ(2deg)" eager className="ks-float d2" style={{ width: "100%" }} />
            </div>
            <div className="ks-glass g1 ks-par ks-float d2" style={{ "--d": "22px" }}>
              <small>Today’s profit</small><b>₦13,150</b><span className="up">▲ 15% vs yesterday</span>
              <div style={{ width: 150, marginTop: 6 }}><AreaChart points={[8, 11, 9, 14, 13, 18, 21]} w={150} h={42} /></div>
            </div>
            <div className="ks-glass g2 ks-par ks-float" style={{ "--d": "-20px" }}>
              <small>Transfer received</small><b>+₦46,200</b><span style={{ fontSize: 12, color: "#cbd5e1" }}>into your KudiAI wallet</span>
            </div>
            <div className="ks-glass g3 ks-par ks-float d3" style={{ "--d": "16px" }}>
              <Ring pct={72} size={64} stroke={8} />
              <div><small>School fees</small><b style={{ fontSize: 18 }}>72% saved</b></div>
            </div>
            <Icon3D name="wallet" size={120} depth={30} style={{ right: "-4%", top: "300px", zIndex: 5 }} className="ks-float d2 hm-wallet3d" />
          </div>
        </div>
      </section>

      <div className="hm-marq" aria-label="Services">
        <div className="ks-marq-in">
          {[...H.services, ...H.services].map((s, i) => <span key={i} aria-hidden={i >= H.services.length}>{s}</span>)}
        </div>
      </div>

      <section className="ks-sec">
        <div className="ks-wrap">
          <div className="ks-center ks-reveal">
            <div className="ks-eyebrow">Everything in one app</div>
            <h2 className="ks-h2">Everything your business needs.<br />Nothing it doesn’t.</h2>
            <p className="ks-sub">From the first sale of the morning to the last contribution of the night, KudiAI Track keeps the numbers straight.</p>
          </div>
          <div className="hm-bento">
            {H.bento.map(([icon, title, text, href], i) => (
              <TiltCard as="a" href={href} key={title} className={`hm-bcard ks-reveal d${(i % 3) + 1}${i === 0 ? " big" : ""}`}>
                <img src={`/site/3d/${icon}.webp`} alt="" loading="lazy" />
                <h3>{title}</h3>
                <p>{text}</p>
                <span className="go">Learn more →</span>
              </TiltCard>
            ))}
          </div>
        </div>
      </section>

      <section className="ks-sec" style={{ paddingTop: 20 }}>
        <div className="ks-wrap hm-split">
          <div className="ks-reveal">
            <div className="ks-eyebrow">Sales & profit</div>
            <h2 className="ks-h2">{H.profit.title}</h2>
            <p className="ks-sub">{H.profit.text}</p>
            <ul className="hm-list">{H.profit.points.map((p) => <li key={p}>{p}</li>)}</ul>
            <div style={{ marginTop: 26 }}><a className="ks-btn line" href="/features#sales">How profit works →</a></div>
          </div>
          <div className="ks-reveal d2" style={{ position: "relative" }}>
            <div className="hm-dash">
              <div className="row">
                <div className="hm-tile"><small>This week’s sales</small><b>₦86,450</b><span className="up">▲ 12%</span></div>
                <div className="hm-tile"><small>Real profit</small><b>₦13,150</b><span className="up">▲ 15%</span></div>
              </div>
              <div className="hm-tile" style={{ color: "#9fb0d9" }}>
                <small>Profit by day</small>
                <Bars values={[38, 52, 44, 70, 61, 92, 66]} />
              </div>
              <div className="hm-tile" style={{ marginTop: 12 }}>
                <small>Profit trend</small>
                <AreaChart points={[10, 14, 12, 19, 17, 24, 29, 27, 34]} h={90} />
              </div>
            </div>
            <Icon3D name="chart" size={130} className="ks-float" style={{ right: "-18px", top: "-56px" }} />
          </div>
        </div>
      </section>

      <section className="ks-sec ks-dark ks-mesh">
        <div className="ks-wrap">
          <div className="ks-center ks-reveal">
            <div className="ks-eyebrow" style={{ color: "#7ee06a" }}>Business wallet</div>
            <h2 className="ks-h2">{H.flow.title}</h2>
            <p className="ks-sub">{H.flow.text}</p>
          </div>
          <div className="hm-flow ks-reveal d1">
            <div className="hm-col">
              <div className="hm-node"><img src="/site/3d/team.webp" alt="" loading="lazy" /><div><b>Customers</b><span>Pay by bank transfer</span></div></div>
              <div className="hm-node"><img src="/site/3d/pot.webp" alt="" loading="lazy" /><div><b>Savers</b><span>Ajo contributions</span></div></div>
            </div>
            <div className="ks-flowline" />
            <div className="hm-hub"><img src="/site/3d/wallet.webp" alt="" loading="lazy" /><b>Your KudiAI wallet</b><span>Your own account number</span></div>
            <div className="ks-flowline" />
            <div className="hm-col">
              <div className="hm-node"><img src="/site/3d/coins.webp" alt="" loading="lazy" /><div><b>Any Nigerian bank</b><span>Pay suppliers, withdraw</span></div></div>
              <div className="hm-node"><img src="/site/3d/bills.webp" alt="" loading="lazy" /><div><b>Bills & recharge</b><span>Airtime, data, power, TV</span></div></div>
              <div className="hm-node"><img src="/site/3d/shield.webp" alt="" loading="lazy" /><div><b>Verifiable receipt</b><span>For every movement</span></div></div>
            </div>
          </div>
        </div>
      </section>

      <section className="ks-sec">
        <div className="ks-wrap hm-split flip">
          <div className="ks-reveal">
            <div className="ks-eyebrow">Ajo & Esusu</div>
            <h2 className="ks-h2">{H.ajo.title}</h2>
            <p className="ks-sub">{H.ajo.text}</p>
            <ul className="hm-list">{H.ajo.points.map((p) => <li key={p}>{p}</li>)}</ul>
            <div style={{ marginTop: 26 }}><a className="ks-btn line" href="/features#ajo">Explore Ajo features →</a></div>
          </div>
          <div className="ks-scene ks-reveal d2" style={{ display: "flex", justifyContent: "center", minHeight: 460 }}>
            <Icon3D name="pot" size={170} depth={-18} className="ks-float hm-pot" style={{ left: "2%", top: "40px", zIndex: 3 }} />
            <div className="ks-par" style={{ "--d": "8px" }}>
              <Phone shot="ajo" alt="Ajo savings management in KudiAI Track" tilt="rotateY(-14deg) rotateX(5deg)" className="ks-float d2" />
            </div>
            <div className="ks-glass ks-par ks-float d3" style={{ "--d": "18px", right: "0", bottom: "40px", background: "rgba(11,20,55,.82)" }}>
              <small>Total savings held</small><b>₦500,500</b><span className="up">11 savers · all up to date</span>
            </div>
          </div>
        </div>
      </section>

      <section className="ks-sec ks-dark ks-mesh">
        <div className="ks-wrap hm-split">
          <div className="ks-reveal" style={{ position: "relative", display: "flex", justifyContent: "center" }}>
            <img src="/site/3d/shield.webp" alt="" loading="lazy" className="ks-float" style={{ width: "min(320px,70vw)", filter: "drop-shadow(0 40px 50px rgba(0,0,0,.5))" }} />
          </div>
          <div className="ks-reveal d2">
            <div className="ks-eyebrow" style={{ color: "#7ee06a" }}>Security</div>
            <h2 className="ks-h2">{H.security.title}</h2>
            <div className="hm-sec3" style={{ marginTop: 24 }}>
              {H.security.points.map(([t, d], i) => (
                <div className="hm-sitem" key={t}><i>{String(i + 1).padStart(2, "0")}</i><div><b>{t}</b><span>{d}</span></div></div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="ks-sec">
        <div className="ks-wrap">
          <div className="ks-center ks-reveal">
            <div className="ks-eyebrow">Who it’s for</div>
            <h2 className="ks-h2">Made for the way Nigerians do business.</h2>
          </div>
          <div className="hm-aud" style={{ marginTop: 34 }}>
            {F.audiences.map((a, i) => (
              <TiltCard className={`ks-card ks-reveal d${(i % 3) + 1}`} key={a.title}>
                <h3 style={{ color: "var(--ink)", margin: "0 0 6px", fontSize: 18 }}>{a.title}</h3>
                <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6, fontSize: 15 }}>{a.text}</p>
              </TiltCard>
            ))}
          </div>
        </div>
      </section>

      <section className="ks-sec" style={{ paddingTop: 0 }}>
        <div className="ks-wrap">
          <div className="ks-center ks-reveal">
            <div className="ks-eyebrow">How it works</div>
            <h2 className="ks-h2">Up and running in minutes.</h2>
          </div>
          <div className="hm-steps" style={{ marginTop: 40 }}>
            {F.steps.map(([t, d], i) => (
              <div className={`hm-step ks-reveal d${i + 1}`} key={t}><div className="n">{i + 1}</div><h3>{t}</h3><p>{d}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="ks-sec" style={{ paddingTop: 0 }}>
        <div className="ks-wrap" style={{ maxWidth: 880 }}>
          <div className="ks-center ks-reveal">
            <div className="ks-eyebrow">FAQ</div>
            <h2 className="ks-h2">Questions, answered.</h2>
          </div>
          <div className="ks-reveal d1" style={{ marginTop: 28 }}><Faq items={faq} /></div>
          <div className="ks-center" style={{ marginTop: 24 }}><a className="ks-btn line" href="/faq">See all questions →</a></div>
        </div>
      </section>

      <CtaBand />
    </SiteShell>
  );
}

