import { useEffect } from "react";
import SEO from "../content/founderSeo.json";   // also read by scripts/seo-pages.js, which writes /founder's own HTML head for search engines

/**
 * Public page at /founder — a magazine-style founder's note: the story, the problem, the why, what we are building now and
 * where we are going, with a pull quote in the middle and an "about the author" box with the founder's links.
 * Reached with no session (rendered before the auth gate in App.jsx). Links out are plain anchors, so leaving is a full load.
 */
const NAME = "Solomon Leon Johnson";
const TITLE = "Founder & CEO, Amaya & Co. Technologies";
const COMPANY = "Amaya & Co. Technologies";
const PHOTO = "/people/solomon-leon-johnson.jpg";
const EMAIL = "solomon.john@amayatechnologies.com";
const FONTS = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap";

const SOCIAL = [
  { label: "Facebook", href: "https://www.facebook.com/leonrichy",
    icon: <path fill="currentColor" d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" /> },
  { label: "Instagram", href: "https://www.instagram.com/leonrichy",
    icon: <g fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" /></g> },
  { label: "X (Twitter)", href: "https://x.com/leonrichy",
    icon: <path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" /> },
  { label: "TikTok", href: "https://www.tiktok.com/@leonrichy",
    icon: <path fill="currentColor" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" /> },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/leonrichy",
    icon: <path fill="currentColor" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /> },
];

const BUILDING = [
  ["Your language, your way", "Use the app in English, Pidgin, Hausa, Igbo or Yoruba, and record a sale by voice or with a tap."],
  ["Profit you can trust", "The cost price is saved with every sale, so the profit you see is real profit, not a guess."],
  ["Stock and credit, handled", "Low-stock alerts before the shelf is empty. Every debt tracked, with a reminder one tap away."],
  ["A wallet for the business", "Your own account number to get paid, send to any bank, and buy airtime, data and power."],
  ["Ajo and Esusu, without paper", "Savings cards, contribution records and monthly statements for collectors and the people who trust them."],
  ["Proof, not promises", "Every receipt carries a QR code anyone can check at kudiai.app/verify. No more fake alerts."],
];

const CSS = `
.fdr{--paper:#F6F1E8;--paper2:#EFE6D8;--ink:#1A1714;--muted:#6B6158;--rule:#D8CCBB;--bronze:#9A6B3F;--band:#1C1712;--bandInk:#F4EDE2;--green:#3DA829;
  min-height:100dvh;background:var(--paper);color:var(--ink);font-family:'Source Serif 4',Georgia,'Times New Roman',serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.dark .fdr{--paper:#13100D;--paper2:#1B1612;--ink:#F1EADF;--muted:#B2A694;--rule:#3B3229;--bronze:#C99A66;--band:#0B0907;--bandInk:#F4EDE2}
.fdr *{box-sizing:border-box}
.fdr a{color:inherit}
.fdr-wrap{max-width:1120px;margin:0 auto;padding:0 16px}
.fdr-sans{font-family:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif}
.fdr-disp{font-family:'Playfair Display',Georgia,'Times New Roman',serif}
.fdr-caps{font-family:'DM Sans',system-ui,sans-serif;font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase}

.fdr-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:max(20px,env(safe-area-inset-top));padding-bottom:18px}
.fdr-brand{display:flex;align-items:center;gap:10px;text-decoration:none}
.fdr-brand img{width:32px;height:32px;border-radius:8px;background:#fff;padding:3px}
.fdr-brand b{font-family:'DM Sans',system-ui,sans-serif;font-weight:800;font-size:15px;letter-spacing:.01em}
.fdr-brand span{display:block;font-family:'DM Sans',system-ui,sans-serif;font-size:11px;color:var(--muted)}
.fdr-toplink{font-family:'DM Sans',system-ui,sans-serif;font-size:13px;font-weight:600;text-decoration:none;border-bottom:1px solid var(--rule);padding-bottom:2px}

.fdr-mast{border-top:1px solid var(--ink);border-bottom:1px solid var(--rule);padding:10px 0;display:flex;justify-content:space-between;gap:12px;color:var(--muted);flex-wrap:wrap}

.fdr-hero{display:grid;gap:36px;padding:40px 0 56px;align-items:center}
@media(min-width:900px){.fdr-hero{grid-template-columns:5fr 6fr;gap:72px;padding:64px 0 88px}}
.fdr-fig{margin:0;position:relative}
.fdr-frame{position:relative;border-radius:2px;overflow:hidden;box-shadow:0 30px 60px -30px rgba(40,24,10,.45)}
.fdr-frame img{display:block;width:100%;height:auto;aspect-ratio:852/1280;object-fit:cover}
.fdr-photo{position:relative;margin-right:14px}
.fdr-photo:before{content:"";position:absolute;inset:14px -14px -14px 14px;border:1px solid var(--bronze);opacity:.55;pointer-events:none}
.fdr-fig figcaption{margin-top:30px;font-style:italic;font-size:14px;color:var(--muted)}
.fdr-kicker{color:var(--bronze);margin-bottom:18px}
.fdr-h1{font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:clamp(38px,6.4vw,68px);line-height:1.04;letter-spacing:-.015em;margin:0 0 22px}
.fdr-h1 em{color:var(--bronze);font-style:italic;font-weight:500}
.fdr-dek{font-size:clamp(18px,2.1vw,21px);line-height:1.6;color:var(--muted);margin:0 0 28px;max-width:560px}
.fdr-by{display:flex;align-items:center;gap:14px;padding-top:20px;border-top:1px solid var(--rule)}
.fdr-by b{display:block;font-family:'DM Sans',system-ui,sans-serif;font-size:15px}
.fdr-by span{font-family:'DM Sans',system-ui,sans-serif;font-size:13px;color:var(--muted)}
.fdr-rule{width:44px;height:2px;background:var(--bronze);flex:none}

.fdr-art{max-width:680px;margin:0 auto;padding:0 16px}
.fdr-sec{padding:40px 0 8px}
.fdr-chap{display:flex;align-items:baseline;gap:14px;margin-bottom:10px;color:var(--bronze)}
.fdr-chap i{font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:500}
.fdr-h2{font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:clamp(28px,4vw,36px);line-height:1.15;margin:0 0 18px;letter-spacing:-.01em}
.fdr-p{font-size:clamp(17px,1.9vw,19px);line-height:1.78;margin:0 0 20px}
.fdr-drop:first-letter{font-family:'Playfair Display',Georgia,serif;float:left;font-size:4.6em;line-height:.82;padding:6px 12px 0 0;color:var(--bronze);font-weight:600}

.fdr-quote{background:var(--band);color:var(--bandInk);margin:56px 0;padding:72px 0;position:relative;overflow:hidden}
.fdr-quote:before{content:"\\201C";position:absolute;top:-40px;left:50%;transform:translateX(-50%);font-family:'Playfair Display',Georgia,serif;font-size:260px;line-height:1;color:var(--bronze);opacity:.22}
.fdr-quote blockquote{position:relative;max-width:900px;margin:0 auto;padding:0 20px;text-align:center}
.fdr-quote p{font-family:'Playfair Display',Georgia,serif;font-style:italic;font-weight:500;font-size:clamp(25px,4.2vw,44px);line-height:1.32;margin:0 0 30px}
.fdr-quote p em{font-style:normal;color:#E2B98A}
.fdr-quote footer{display:flex;align-items:center;justify-content:center;gap:14px;color:#CDBFAC}
.fdr-quote footer .fdr-rule{background:#E2B98A}

.fdr-grid{display:grid;gap:0;margin:8px 0 24px;border-top:1px solid var(--rule)}
@media(min-width:640px){.fdr-grid{grid-template-columns:1fr 1fr;column-gap:36px}}
.fdr-item{padding:20px 0;border-bottom:1px solid var(--rule)}
.fdr-item small{display:block;font-family:'Playfair Display',Georgia,serif;font-style:italic;color:var(--bronze);font-size:15px;margin-bottom:4px}
.fdr-item b{display:block;font-family:'DM Sans',system-ui,sans-serif;font-size:16px;margin-bottom:6px}
.fdr-item span{font-size:16px;line-height:1.6;color:var(--muted)}

.fdr-sign{padding:28px 0 8px}
.fdr-sign p{font-style:italic;color:var(--muted);margin:0 0 6px;font-size:18px}
.fdr-sign .fdr-name{font-family:'Playfair Display',Georgia,serif;font-style:italic;font-size:clamp(30px,4vw,40px);font-weight:500;margin:0;color:var(--ink)}

.fdr-author{margin:48px 0 0;padding:32px 0;border-top:1px solid var(--ink);border-bottom:1px solid var(--rule);display:grid;gap:22px}
@media(min-width:640px){.fdr-author{grid-template-columns:112px 1fr;gap:28px}}
.fdr-author img{width:112px;height:112px;border-radius:50%;object-fit:cover;object-position:50% 22%;border:1px solid var(--rule)}
.fdr-author h3{font-family:'Playfair Display',Georgia,serif;font-size:26px;font-weight:600;margin:6px 0 2px}
.fdr-author .fdr-role{font-family:'DM Sans',system-ui,sans-serif;font-size:14px;color:var(--bronze);font-weight:600;margin:0 0 12px}
.fdr-social{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
.fdr-social a{width:42px;height:42px;border-radius:50%;border:1px solid var(--rule);display:inline-flex;align-items:center;justify-content:center;transition:background .2s,color .2s,border-color .2s}
.fdr-social a:hover,.fdr-social a:focus-visible{background:var(--ink);color:var(--paper);border-color:var(--ink);outline:none}
.fdr-social svg{width:17px;height:17px}
.fdr-mail{display:inline-flex;align-items:center;gap:8px;margin-top:16px;font-family:'DM Sans',system-ui,sans-serif;font-size:14px;font-weight:600;text-decoration:none;border-bottom:1px solid var(--rule);padding-bottom:2px;word-break:break-all}

.fdr-cta{margin:56px 0 0;padding:44px 24px;background:var(--paper2);text-align:center;border-radius:4px}
.fdr-cta h4{font-family:'Playfair Display',Georgia,serif;font-size:clamp(24px,3.4vw,30px);font-weight:600;margin:0 0 8px}
.fdr-cta p{margin:0 0 22px;color:var(--muted);font-size:17px}
.fdr-btn{display:inline-block;background:var(--green);color:#fff !important;text-decoration:none;font-family:'DM Sans',system-ui,sans-serif;font-weight:700;font-size:15px;padding:14px 26px;border-radius:999px;box-shadow:0 10px 24px -12px rgba(61,168,41,.7)}
.fdr-foot{padding:40px 16px calc(32px + env(safe-area-inset-bottom));text-align:center;font-family:'DM Sans',system-ui,sans-serif;font-size:12px;color:var(--muted)}
.fdr-foot a{text-decoration:none;margin:0 8px}

@media(prefers-reduced-motion:no-preference){
  .fdr-rise{animation:fdrRise .9s cubic-bezier(.2,.7,.2,1) both}
  .fdr-rise2{animation:fdrRise .9s .15s cubic-bezier(.2,.7,.2,1) both}
  @keyframes fdrRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
}
`;

export default function FounderPage() {
  useEffect(() => {
    document.title = SEO.title;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", SEO.description);
    if (!document.getElementById("fdr-fonts")) {
      const l = document.createElement("link");
      l.id = "fdr-fonts"; l.rel = "stylesheet"; l.href = FONTS;
      document.head.appendChild(l);
    }
  }, []);

  return (
    <div className="fdr">
      <style>{CSS}</style>

      <header className="fdr-wrap">
        <div className="fdr-top">
          <a className="fdr-brand" href="/">
            <img src="/logo-tp.png" alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            <div><b>KudiAI Track</b><span>by {COMPANY}</span></div>
          </a>
          <a className="fdr-toplink" href="/">Open KudiAI Track →</a>
        </div>
        <div className="fdr-mast fdr-caps"><span>The Founder’s Note</span><span>October 2026</span></div>
      </header>

      <main>
        <section className="fdr-wrap">
          <div className="fdr-hero">
            <figure className="fdr-fig fdr-rise">
              <div className="fdr-photo">
                <div className="fdr-frame">
                  <img src={PHOTO} alt={`Portrait of ${NAME}`} width="852" height="1280" />
                </div>
              </div>
              <figcaption>{NAME}, {TITLE}.</figcaption>
            </figure>
            <div className="fdr-rise2">
              <div className="fdr-caps fdr-kicker">{TITLE}</div>
              <h1 className="fdr-h1">The quiet power of <em>knowing your numbers.</em></h1>
              <p className="fdr-dek">
                {NAME} started Amaya & Co. Technologies with one conviction: the people who keep Nigeria’s economy moving deserve
                tools as serious as their hustle. KudiAI Track is the first of them.
              </p>
              <div className="fdr-by">
                <span className="fdr-rule" />
                <div><b>A note from {NAME}</b><span>On the story, the problem and the road ahead</span></div>
              </div>
            </div>
          </div>
        </section>

        <article>
          <div className="fdr-art">
            <section className="fdr-sec">
              <div className="fdr-chap"><i>I.</i><span className="fdr-caps">The Story</span></div>
              <h2 className="fdr-h2">It started with one question.</h2>
              <p className="fdr-p fdr-drop">
                Every evening, in markets, salons and workshops across Nigeria, a business owner closes for the day and asks a
                simple question: <em>did I make money today?</em> Too often the answer comes from memory, a worn notebook or a
                feeling in the stomach.
              </p>
              <p className="fdr-p">
                I started Amaya & Co. Technologies because that question deserves a real answer: in seconds, in the language you
                think in, on the phone already in your pocket. KudiAI Track is that answer. It is also only the beginning.
              </p>
            </section>

            <section className="fdr-sec">
              <div className="fdr-chap"><i>II.</i><span className="fdr-caps">The Problem</span></div>
              <h2 className="fdr-h2">Our small businesses are not small.</h2>
              <p className="fdr-p">
                Traders, artisans, Ajo collectors and shop owners carry this economy, yet most of them still run on paper and
                memory. Sales mix with personal money. Debts are forgotten. Stock runs out without warning. Savings live in
                notebooks that can be lost, and one fake transfer alert can cost an honest seller a whole day’s goods.
              </p>
              <p className="fdr-p">
                Without records there is no proof. Without proof there is no loan, no investor and no plan. Hard work alone
                cannot fix that.
              </p>
            </section>

            <section className="fdr-sec">
              <div className="fdr-chap"><i>III.</i><span className="fdr-caps">The Why</span></div>
              <h2 className="fdr-h2">Numbers are power.</h2>
              <p className="fdr-p">
                When a trader knows her real profit, she prices with confidence. When an Ajo collector’s records are digital and
                verifiable, his savers trust him with more. When a young business can show clean books, it can borrow, hire and
                grow.
              </p>
              <p className="fdr-p">
                Many of Nigeria’s next great companies are already open for business, in stalls, salons and workshops. They do
                not need permission. They need to see their numbers.
              </p>
            </section>
          </div>

          <aside className="fdr-quote" aria-label="Quote">
            <blockquote>
              <p>
                Nigerian youth are moving from <em>learning</em> to <em>earning</em>, from seeking validation to{" "}
                <em>owning</em> validation, from requesting a seat at the table to <em>owning the table.</em>
              </p>
              <footer className="fdr-caps"><span className="fdr-rule" />{NAME}<span className="fdr-rule" /></footer>
            </blockquote>
          </aside>

          <div className="fdr-art">
            <section className="fdr-sec">
              <div className="fdr-chap"><i>IV.</i><span className="fdr-caps">Today</span></div>
              <h2 className="fdr-h2">What we are building now.</h2>
              <p className="fdr-p">KudiAI Track is one app for the way Nigerians really do business:</p>
              <div className="fdr-grid">
                {BUILDING.map(([t, d], i) => (
                  <div className="fdr-item" key={t}>
                    <small>{String(i + 1).padStart(2, "0")}</small>
                    <b>{t}</b>
                    <span>{d}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="fdr-sec">
              <div className="fdr-chap"><i>V.</i><span className="fdr-caps">Tomorrow</span></div>
              <h2 className="fdr-h2">Where we are going.</h2>
              <p className="fdr-p">
                Our vision is a Nigeria where every trader, artisan and small business knows their numbers and grows with
                confidence. Our mission is to give every one of them simple, smart tools to track money, grow profit and save
                for tomorrow.
              </p>
              <p className="fdr-p">
                Next, we want those clean records to open doors: to fair credit, to better suppliers, to growth. We also want
                to open doors for young Nigerians, who can build and earn on this platform while they help other businesses grow.
                We are not asking anyone for a seat. We are building the table, and there is room for you at it.
              </p>
              <div className="fdr-sign">
                <p>With gratitude and grit,</p>
                <p className="fdr-name">{NAME}</p>
              </div>
            </section>

            <section className="fdr-author" aria-label="About the author">
              <img src={PHOTO} alt="" />
              <div>
                <div className="fdr-caps" style={{ color: "var(--muted)" }}>About the author</div>
                <h3>{NAME}</h3>
                <p className="fdr-role">{TITLE}</p>
                <p className="fdr-p" style={{ fontSize: 17, marginBottom: 0 }}>
                  {NAME} is the founder and chief executive of {COMPANY}, the company behind KudiAI Track,
                  a business, savings and payments app built for Nigerian traders, artisans and Ajo collectors.
                </p>
                <div className="fdr-social">
                  {SOCIAL.map((s) => (
                    <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={`${NAME} on ${s.label}`} title={s.label}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">{s.icon}</svg>
                    </a>
                  ))}
                </div>
                <a className="fdr-mail" href={`mailto:${EMAIL}`}>
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
                  {EMAIL}
                </a>
              </div>
            </section>

            <section className="fdr-cta">
              <h4>Ready to know your numbers?</h4>
              <p>Record your first sale in under a minute.</p>
              <a className="fdr-btn" href="/">Start with KudiAI Track</a>
            </section>
          </div>
        </article>
      </main>

      <footer className="fdr-foot">
        <div>© {new Date().getFullYear()} {COMPANY} · KudiAI Track</div>
        <div style={{ marginTop: 10 }}>
          <a href="/home">Home</a>·<a href="/features">Features</a>·<a href="/about">About</a>·<a href="/verify">Verify a receipt</a>·<a href="/privacy">Privacy</a>·<a href="/terms">Terms</a>·<a href="mailto:support@kudiai.app">support@kudiai.app</a>
        </div>
      </footer>
    </div>
  );
}
