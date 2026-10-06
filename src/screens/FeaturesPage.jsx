import { useEffect } from "react";
import C from "../content/features.json";   // also read by scripts/seo-pages.js (search-engine head, crawler text, llms.txt)

/**
 * Public page at /features — what KudiAI Track is, who it is for and everything it does, for people and search engines.
 * Reached with no session (rendered before the auth gate in App.jsx). Every claim here is checked against the app;
 * features that are switched off (business loans, cooperatives) are deliberately left out.
 */
const CSS = `
.ftr{--bg:#F7F8FA;--card:#fff;--ink:#0f1c45;--text:#334155;--muted:#64748b;--line:#e2e8f0;--green:#3DA829;--green2:#2f8a1f;--navy:#0f1c45;--navy2:#1b2d6b;--soft:#eef6ea;
  min-height:100dvh;background:var(--bg);color:var(--text);font-family:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.dark .ftr{--bg:#0b1020;--card:#121a33;--ink:#eef2ff;--text:#cbd5e1;--muted:#94a3b8;--line:#22305a;--soft:#13261a}
.ftr *{box-sizing:border-box}
.ftr a{color:inherit}
.ftr-wrap{max-width:1160px;margin:0 auto;padding:0 16px}

.ftr-nav{position:sticky;top:0;z-index:10;background:rgba(15,28,69,.92);backdrop-filter:saturate(1.4) blur(10px);-webkit-backdrop-filter:saturate(1.4) blur(10px);padding-top:env(safe-area-inset-top)}
.ftr-nav .ftr-wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;height:62px}
.ftr-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:#fff !important}
.ftr-brand img{width:32px;height:32px;border-radius:8px;background:#fff;padding:3px}
.ftr-brand b{font-weight:800;font-size:16px}
.ftr-links{display:none;gap:22px;font-size:14px;font-weight:600}
.ftr-links a{color:#cbd5e1 !important;text-decoration:none}
.ftr-links a:hover{color:#fff !important}
@media(min-width:860px){.ftr-links{display:flex}}
.ftr-open{background:var(--green);color:#fff !important;text-decoration:none;font-weight:700;font-size:14px;padding:9px 16px;border-radius:999px;white-space:nowrap}

.ftr-hero{background:radial-gradient(1200px 500px at 85% -10%,#2a4bb0 0%,transparent 60%),linear-gradient(160deg,var(--navy) 0%,#0a1433 100%);color:#fff;padding:48px 0 0;overflow:hidden}
.ftr-hero .ftr-wrap{display:grid;gap:36px;align-items:end}
@media(min-width:900px){.ftr-hero .ftr-wrap{grid-template-columns:1.1fr .9fr;gap:48px;align-items:center}.ftr-hero{padding:72px 0 0}}
.ftr-kicker{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#a7f3a0;background:rgba(61,168,41,.14);border:1px solid rgba(61,168,41,.35);padding:6px 12px;border-radius:999px;margin-bottom:18px}
.ftr-h1{font-size:clamp(36px,6vw,62px);line-height:1.04;font-weight:800;letter-spacing:-.025em;margin:0 0 18px;color:#fff}
.ftr-h1 span{color:#7ee06a}
.ftr-lead{font-size:clamp(17px,2vw,19px);line-height:1.6;color:#cbd5e1;margin:0 0 26px;max-width:600px}
.ftr-ctas{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:26px}
.ftr-btn{display:inline-flex;align-items:center;gap:8px;background:var(--green);color:#fff !important;text-decoration:none;font-weight:700;font-size:16px;padding:14px 24px;border-radius:999px;box-shadow:0 14px 30px -14px rgba(61,168,41,.9)}
.ftr-btn.ghost{background:transparent;border:1px solid rgba(255,255,255,.35);box-shadow:none}
.ftr-chips{display:flex;flex-wrap:wrap;gap:8px;padding-bottom:40px}
.ftr-chips span{font-size:13px;font-weight:600;color:#e2e8f0;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);padding:7px 12px;border-radius:999px}
.ftr-heroshots{position:relative;display:flex;justify-content:center;gap:16px;min-height:340px}
.ftr-heroshots .ftr-phone:nth-child(2){transform:translateY(46px);display:none}
@media(min-width:520px){.ftr-heroshots .ftr-phone:nth-child(2){display:block}}

.ftr-phone{width:min(250px,62vw);flex:none;background:#0b0f1a;border-radius:34px;padding:9px;box-shadow:0 40px 80px -30px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08) inset}
.ftr-phone img{display:block;width:100%;height:auto;aspect-ratio:540/1199;object-fit:cover;object-position:top;border-radius:26px;background:#fff}
.ftr-hero .ftr-phone{margin-bottom:-60px}

.ftr-sec{padding:72px 0}
.ftr-eyebrow{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--green);margin-bottom:10px}
.ftr-h2{font-size:clamp(28px,4vw,40px);line-height:1.12;font-weight:800;letter-spacing:-.02em;color:var(--ink);margin:0 0 14px}
.ftr-sub{font-size:17px;line-height:1.6;color:var(--muted);margin:0 0 32px;max-width:680px}

.ftr-aud{display:grid;gap:14px}
@media(min-width:640px){.ftr-aud{grid-template-columns:repeat(2,1fr)}}
@media(min-width:980px){.ftr-aud{grid-template-columns:repeat(3,1fr)}}
.ftr-card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px}
.ftr-card h3{font-size:17px;font-weight:800;color:var(--ink);margin:0 0 6px}
.ftr-card p{font-size:15px;line-height:1.55;margin:0;color:var(--muted)}
.ftr-dot{width:36px;height:36px;border-radius:10px;background:var(--soft);color:var(--green);display:flex;align-items:center;justify-content:center;margin-bottom:12px;font-weight:800}

.ftr-row{display:grid;gap:34px;align-items:center;padding:36px 0;border-top:1px solid var(--line)}
@media(min-width:880px){.ftr-row{grid-template-columns:1fr 1fr;gap:64px;padding:56px 0}.ftr-row.flip .ftr-rowshot{order:-1}}
.ftr-rowshot{display:flex;justify-content:center}
.ftr-rowshot .ftr-phone{width:min(270px,70vw)}
.ftr-list{list-style:none;padding:0;margin:18px 0 0;display:grid;gap:14px}
.ftr-list li{display:grid;grid-template-columns:26px 1fr;gap:10px;align-items:start}
.ftr-list svg{width:22px;height:22px;color:var(--green);margin-top:1px}
.ftr-list b{display:block;color:var(--ink);font-size:16px;margin-bottom:2px}
.ftr-list span{font-size:15px;line-height:1.55;color:var(--muted)}

.ftr-steps{display:grid;gap:14px;counter-reset:s}
@media(min-width:820px){.ftr-steps{grid-template-columns:repeat(3,1fr)}}
.ftr-step{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px;position:relative}
.ftr-step:before{counter-increment:s;content:counter(s);display:flex;width:34px;height:34px;border-radius:50%;background:var(--navy);color:#fff;font-weight:800;align-items:center;justify-content:center;margin-bottom:14px}
.dark .ftr-step:before{background:var(--green)}
.ftr-step h3{margin:0 0 6px;font-size:17px;color:var(--ink)}
.ftr-step p{margin:0;color:var(--muted);font-size:15px;line-height:1.55}

.ftr-faq{display:grid;gap:10px;max-width:820px}
.ftr-faq details{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:0 18px}
.ftr-faq summary{cursor:pointer;list-style:none;padding:17px 0;font-weight:700;color:var(--ink);font-size:16px;display:flex;justify-content:space-between;gap:12px}
.ftr-faq summary::-webkit-details-marker{display:none}
.ftr-faq summary:after{content:"+";font-size:22px;line-height:1;color:var(--green);flex:none}
.ftr-faq details[open] summary:after{content:"−"}
.ftr-faq p{margin:0 0 18px;line-height:1.65;font-size:15px;color:var(--muted)}

.ftr-final{background:linear-gradient(135deg,var(--navy) 0%,var(--navy2) 100%);color:#fff;border-radius:24px;padding:48px 24px;text-align:center}
.ftr-final h2{font-size:clamp(26px,3.6vw,36px);margin:0 0 10px;font-weight:800;letter-spacing:-.02em}
.ftr-final p{margin:0 0 24px;color:#cbd5e1;font-size:17px}

.ftr-foot{padding:40px 16px calc(32px + env(safe-area-inset-bottom));text-align:center;font-size:13px;color:var(--muted)}
.ftr-foot nav{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 18px;margin-bottom:12px}
.ftr-foot nav a{text-decoration:none;font-weight:600}
`;

const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" strokeWidth="1.6" opacity=".35" /><path d="m7.5 12.5 3 3 6-6.5" />
  </svg>
);

const Phone = ({ shot, alt, eager }) => (
  <div className="ftr-phone">
    <img src={`/shots/${shot}.jpg`} alt={alt} width="540" height="1199" loading={eager ? "eager" : "lazy"} decoding="async" />
  </div>
);

export default function FeaturesPage() {
  useEffect(() => {
    document.title = C.seo.title;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", C.seo.description);
  }, []);

  const [titleA, titleB] = [C.hero.title.replace(/ from your phone\.$/, ""), "from your phone."];

  return (
    <div className="ftr">
      <style>{CSS}</style>

      <header className="ftr-nav">
        <div className="ftr-wrap">
          <a className="ftr-brand" href="/">
            <img src="/logo-tp.png" alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            <b>KudiAI Track</b>
          </a>
          <nav className="ftr-links" aria-label="Sections">
            <a href="#who">Who it’s for</a><a href="#features">Features</a><a href="#savers">For savers</a><a href="#faq">FAQ</a>
          </nav>
          <a className="ftr-open" href="/">Open the app</a>
        </div>
      </header>

      <main>
        <section className="ftr-hero">
          <div className="ftr-wrap">
            <div>
              <div className="ftr-kicker">{C.hero.kicker}</div>
              <h1 className="ftr-h1">{titleA} <span>{titleB}</span></h1>
              <p className="ftr-lead">{C.hero.lead}</p>
              <div className="ftr-ctas">
                <a className="ftr-btn" href="/">Start free →</a>
                <a className="ftr-btn ghost" href="#features">See every feature</a>
              </div>
              <div className="ftr-chips">{C.hero.chips.map((c) => <span key={c}>{c}</span>)}</div>
            </div>
            <div className="ftr-heroshots">
              <Phone shot="dashboard" alt="KudiAI Track dashboard with today's sales and profit" eager />
              <Phone shot="savings-card" alt="An Ajo saver's daily savings card in KudiAI Track" eager />
            </div>
          </div>
        </section>

        <section className="ftr-sec" id="who" style={{ paddingTop: 110 }}>
          <div className="ftr-wrap">
            <div className="ftr-eyebrow">Who it’s for</div>
            <h2 className="ftr-h2">One app for the way Nigerians do business.</h2>
            <p className="ftr-sub">{C.summary}</p>
            <div className="ftr-aud">
              {C.audiences.map((a, i) => (
                <div className="ftr-card" key={a.title}>
                  <div className="ftr-dot">{String(i + 1).padStart(2, "0")}</div>
                  <h3>{a.title}</h3>
                  <p>{a.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="ftr-sec" id="features" style={{ paddingTop: 24 }}>
          <div className="ftr-wrap">
            <div className="ftr-eyebrow">Features</div>
            <h2 className="ftr-h2">Everything KudiAI Track does.</h2>
            <p className="ftr-sub">Real screens from the app.</p>
            {C.groups.map((g, i) => (
              <div className={`ftr-row${i % 2 ? " flip" : ""}`} id={g.id} key={g.id}>
                <div>
                  <h3 className="ftr-h2" style={{ fontSize: "clamp(24px,3vw,32px)" }}>{g.title}</h3>
                  <p className="ftr-sub" style={{ marginBottom: 0 }}>{g.intro}</p>
                  <ul className="ftr-list">
                    {g.items.map(([t, d]) => (
                      <li key={t}><Check /><div><b>{t}</b><span>{d}</span></div></li>
                    ))}
                  </ul>
                </div>
                <div className="ftr-rowshot"><Phone shot={g.shot} alt={`${g.title} in KudiAI Track`} /></div>
              </div>
            ))}
          </div>
        </section>

        <section className="ftr-sec" style={{ paddingTop: 0 }}>
          <div className="ftr-wrap">
            <div className="ftr-eyebrow">And more</div>
            <h2 className="ftr-h2">Built to grow with you.</h2>
            <div className="ftr-aud" style={{ marginTop: 24 }}>
              {C.extras.map((x) => (
                <div className="ftr-card" key={x.title}><h3>{x.title}</h3><p>{x.text}</p></div>
              ))}
            </div>
          </div>
        </section>

        <section className="ftr-sec" style={{ paddingTop: 0 }}>
          <div className="ftr-wrap">
            <div className="ftr-eyebrow">How it works</div>
            <h2 className="ftr-h2">Up and running in minutes.</h2>
            <div className="ftr-steps" style={{ marginTop: 24 }}>
              {C.steps.map(([t, d]) => <div className="ftr-step" key={t}><h3>{t}</h3><p>{d}</p></div>)}
            </div>
          </div>
        </section>

        <section className="ftr-sec" id="faq" style={{ paddingTop: 0 }}>
          <div className="ftr-wrap">
            <div className="ftr-eyebrow">FAQ</div>
            <h2 className="ftr-h2">Questions, answered.</h2>
            <div className="ftr-faq" style={{ marginTop: 24 }}>
              {C.faq.map(([q, a], i) => (
                <details key={q} open={i === 0}><summary>{q}</summary><p>{a}</p></details>
              ))}
            </div>
          </div>
        </section>

        <section className="ftr-sec" style={{ paddingTop: 0 }}>
          <div className="ftr-wrap">
            <div className="ftr-final">
              <h2>Know your numbers. Grow your business.</h2>
              <p>Start free at kudiai.app.</p>
              <a className="ftr-btn" href="/">Start free →</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="ftr-foot">
        <nav aria-label="More">
          <a href="/founder">Meet the founder</a><a href="/verify">Verify a receipt</a><a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a><a href="/delete-account">Delete account</a><a href="mailto:support@kudiai.app">support@kudiai.app</a>
        </nav>
        <div>© {new Date().getFullYear()} Amaya &amp; Co. Technologies · KudiAI Track</div>
      </footer>
    </div>
  );
}
