import { useEffect, useRef, useState } from "react";
import SITE from "../content/site.json";

/**
 * The public website's shared frame (kudiai.app/home, /features, /about, /faq, /contact, /terms, /privacy):
 * header with mobile menu, footer, design tokens, scroll-reveal, and the 3D / chart building blocks the pages use.
 * The app itself stays at kudiai.app/ — "Sign in" goes there and "Get started" opens it on Create account (?signup=1).
 */
export const SIGNUP = "/?signup=1";

const CSS = `
.ks{--navy:#0B1437;--navy2:#16255A;--blue:#2a4bb0;--green:#3DA829;--green2:#5ED24A;--gold:#E9B949;
  --ink:#0f172a;--text:#475569;--muted:#64748b;--bg:#F6F8FB;--card:#fff;--line:#E5EAF2;--soft:#ecf7e8;
  min-height:100dvh;background:var(--bg);color:var(--text);font-family:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;
  -webkit-font-smoothing:antialiased;overflow-x:hidden;line-height:1.5}
.dark .ks{--ink:#eef2ff;--text:#cbd5e1;--muted:#94a3b8;--bg:#070b1a;--card:#0f1730;--line:#1e2a4d;--soft:#10261a}
.ks *{box-sizing:border-box}
.ks a{color:inherit}
.ks img{max-width:100%}
.ks-wrap{max-width:1200px;margin:0 auto;padding:0 16px}
@media(min-width:768px){.ks-wrap{padding:0 28px}}

/* header */
.ks-head{position:sticky;top:0;z-index:50;background:rgba(11,20,55,.86);backdrop-filter:saturate(1.5) blur(14px);-webkit-backdrop-filter:saturate(1.5) blur(14px);border-bottom:1px solid rgba(255,255,255,.07);padding-top:env(safe-area-inset-top)}
.ks-head .ks-wrap{display:flex;align-items:center;gap:16px;height:66px}
.ks-logo{display:flex;align-items:center;gap:10px;text-decoration:none;color:#fff !important;margin-right:auto}
.ks-logo img{width:34px;height:34px;border-radius:9px;background:#fff;padding:3px}
.ks-logo b{font-weight:800;font-size:17px;letter-spacing:-.01em}
.ks-logo small{display:block;font-size:10.5px;color:#9fb0d9;font-weight:600;letter-spacing:.02em}
.ks-nav{display:none;gap:4px}
.ks-nav a{color:#c9d4f0 !important;text-decoration:none;font-weight:600;font-size:14.5px;padding:8px 12px;border-radius:10px;transition:background .2s,color .2s}
.ks-nav a:hover,.ks-nav a[aria-current="page"]{color:#fff !important;background:rgba(255,255,255,.08)}
.ks-acts{display:none;gap:8px;align-items:center}
@media(min-width:960px){.ks-nav,.ks-acts{display:flex}.ks-burger{display:none !important}}
.ks-signin{color:#fff !important;text-decoration:none;font-weight:700;font-size:14.5px;padding:9px 14px}
.ks-burger{display:inline-flex;width:42px;height:42px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#fff;align-items:center;justify-content:center;cursor:pointer}
.ks-menu{display:none;padding:8px 16px 18px;border-top:1px solid rgba(255,255,255,.08)}
.ks-menu.open{display:block;animation:ksDrop .22s ease}
.ks-menu a{display:block;color:#e2e8f0 !important;text-decoration:none;font-weight:600;font-size:17px;padding:13px 4px;border-bottom:1px solid rgba(255,255,255,.06)}
.ks-menu .ks-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
@keyframes ksDrop{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}

/* buttons */
.ks-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(180deg,#46b832,#359a23);color:#fff !important;text-decoration:none;font-weight:700;font-size:15.5px;padding:13px 22px;border-radius:999px;border:0;cursor:pointer;
  box-shadow:0 14px 30px -14px rgba(61,168,41,.95),inset 0 1px 0 rgba(255,255,255,.25);transition:transform .2s,box-shadow .2s;white-space:nowrap}
.ks-btn:hover{transform:translateY(-2px);box-shadow:0 18px 36px -14px rgba(61,168,41,1),inset 0 1px 0 rgba(255,255,255,.25)}
.ks-btn.ghost{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.28);box-shadow:none}
.ks-btn.line{background:transparent;color:var(--ink) !important;border:1.5px solid var(--line);box-shadow:none}
.ks-btn.sm{padding:9px 16px;font-size:14px}

/* type */
.ks-eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--green);margin-bottom:12px}
.ks-eyebrow:before{content:"";width:18px;height:2px;border-radius:2px;background:currentColor}
.ks-h1{font-size:clamp(38px,6.2vw,68px);line-height:1.02;font-weight:800;letter-spacing:-.035em;margin:0 0 18px;color:#fff}
.ks-h1 em{font-style:normal;background:linear-gradient(90deg,#7ee06a,#E9B949);-webkit-background-clip:text;background-clip:text;color:transparent}
.ks-h2{font-size:clamp(28px,4.2vw,46px);line-height:1.08;font-weight:800;letter-spacing:-.03em;color:var(--ink);margin:0 0 14px}
.ks-sub{font-size:clamp(16px,1.6vw,18.5px);line-height:1.65;color:var(--muted);margin:0 0 28px;max-width:640px}
.ks-sec{padding:84px 0;position:relative}
@media(max-width:640px){.ks-sec{padding:64px 0}}
.ks-center{text-align:center}.ks-center .ks-sub{margin-left:auto;margin-right:auto}

/* dark hero bands */
.ks-dark{background:var(--navy);color:#cbd5e1;position:relative;overflow:hidden;isolation:isolate}
.ks-dark .ks-h2{color:#fff}.ks-dark .ks-sub{color:#aab6d6}
.ks-mesh:before{content:"";position:absolute;inset:-20%;z-index:-2;
  background:radial-gradient(40% 50% at 12% 18%,rgba(61,168,41,.35),transparent 70%),radial-gradient(45% 55% at 88% 6%,rgba(42,75,176,.55),transparent 70%),radial-gradient(30% 40% at 70% 95%,rgba(233,185,73,.18),transparent 70%)}
.ks-mesh:after{content:"";position:absolute;inset:0;z-index:-1;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:56px 56px;
  -webkit-mask-image:radial-gradient(70% 70% at 50% 30%,#000,transparent);mask-image:radial-gradient(70% 70% at 50% 30%,#000,transparent)}
.ks-chips{display:flex;flex-wrap:wrap;gap:8px}
.ks-chips span{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:#e2e8f0;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);padding:7px 12px;border-radius:999px}
.ks-chips span:before{content:"";width:6px;height:6px;border-radius:50%;background:var(--green2);box-shadow:0 0 10px var(--green2)}

/* page hero (inner pages) */
.ks-phero{padding:64px 0 72px}
@media(min-width:900px){.ks-phero{padding:88px 0 96px}}
.ks-phero .ks-wrap{display:grid;gap:28px;align-items:center}
@media(min-width:900px){.ks-phero .ks-wrap{grid-template-columns:1.25fr .75fr}}
.ks-phero .ks-h1{font-size:clamp(34px,5.2vw,56px)}
.ks-phero p{font-size:clamp(16px,1.7vw,19px);color:#aab6d6;line-height:1.6;margin:0;max-width:620px}
.ks-heroart{position:relative;height:220px}
@media(min-width:900px){.ks-heroart{height:300px}}

/* 3D */
.ks-scene{position:relative;perspective:1600px;--px:0;--py:0}
.ks-phone{position:relative;width:min(250px,60vw);background:#05070f;border-radius:38px;padding:9px;transform-style:preserve-3d;
  box-shadow:0 1px 0 1px rgba(255,255,255,.08) inset,0 50px 90px -30px rgba(0,0,0,.65),0 30px 50px -30px rgba(0,0,0,.4),-14px 14px 0 -4px #0c1124}
.ks-phone:before{content:"";position:absolute;inset:9px;border-radius:30px;z-index:2;pointer-events:none;background:linear-gradient(115deg,rgba(255,255,255,.22) 0%,rgba(255,255,255,0) 32%,rgba(255,255,255,0) 70%,rgba(255,255,255,.06) 100%)}
.ks-phone:after{content:"";position:absolute;top:16px;left:50%;width:30%;height:16px;transform:translateX(-50%);background:#05070f;border-radius:0 0 12px 12px;z-index:3;opacity:.0}
.ks-phone img{display:block;width:100%;height:auto;aspect-ratio:540/1199;object-fit:cover;object-position:top;border-radius:30px;background:#fff}
.ks-float{animation:ksFloat 7s ease-in-out infinite}
.ks-float.d2{animation-delay:-2.3s}.ks-float.d3{animation-delay:-4.6s}
@keyframes ksFloat{0%,100%{translate:0 0}50%{translate:0 -14px}}
.ks-i3d{position:absolute;filter:drop-shadow(0 24px 30px rgba(0,0,0,.35));pointer-events:none;user-select:none}
.ks-par{transform:translate3d(calc(var(--px) * var(--d,10px)),calc(var(--py) * var(--d,10px)),0);transition:transform .25s ease-out}

.ks-glass{position:absolute;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.2);backdrop-filter:blur(16px) saturate(1.4);-webkit-backdrop-filter:blur(16px) saturate(1.4);
  border-radius:18px;padding:14px 16px;color:#fff;box-shadow:0 20px 40px -18px rgba(0,0,0,.55);min-width:170px}
.ks-glass small{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#b9c6e8}
.ks-glass b{display:block;font-size:22px;font-weight:800;letter-spacing:-.02em;margin-top:2px}
.ks-glass .up{color:#7ee06a;font-size:12px;font-weight:700}
.ks-card{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:24px;box-shadow:0 1px 2px rgba(15,23,42,.04)}

/* reveal */
.ks-reveal{opacity:0;transform:translateY(26px);transition:opacity .8s cubic-bezier(.2,.7,.2,1),transform .8s cubic-bezier(.2,.7,.2,1)}
.ks-reveal.in{opacity:1;transform:none}
.ks-reveal.d1{transition-delay:.08s}.ks-reveal.d2{transition-delay:.16s}.ks-reveal.d3{transition-delay:.24s}
@media(prefers-reduced-motion:reduce){.ks-reveal{opacity:1;transform:none;transition:none}.ks-float,.ks-marq-in,.ks-flowline{animation:none !important}}

/* charts */
.ks-chart path.line{stroke-dasharray:900;stroke-dashoffset:900;transition:stroke-dashoffset 2s cubic-bezier(.3,.7,.2,1) .2s}
.in .ks-chart path.line,.ks-chart.in path.line{stroke-dashoffset:0}
.ks-chart path.area{opacity:0;transition:opacity 1.2s ease 1s}
.in .ks-chart path.area,.ks-chart.in path.area{opacity:1}
.ks-bars rect{transform-box:fill-box;transform-origin:bottom;transform:scaleY(.04);transition:transform 1.1s cubic-bezier(.2,.8,.2,1)}
.in .ks-bars rect{transform:scaleY(1)}
.ks-ring circle.v{transition:stroke-dashoffset 1.8s cubic-bezier(.3,.7,.2,1) .3s}

/* tilt cards */
.ks-tilt{transform-style:preserve-3d;transition:transform .35s cubic-bezier(.2,.7,.2,1),box-shadow .35s;will-change:transform}
.ks-tilt:hover{box-shadow:0 30px 60px -30px rgba(15,23,42,.35)}

/* faq */
.ks-faq{display:grid;gap:10px}
.ks-faq details{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:0 20px;transition:border-color .2s,box-shadow .2s}
.ks-faq details[open]{border-color:rgba(61,168,41,.45);box-shadow:0 14px 30px -22px rgba(61,168,41,.6)}
.ks-faq summary{cursor:pointer;list-style:none;padding:18px 0;font-weight:700;color:var(--ink);font-size:16px;display:flex;justify-content:space-between;gap:14px;align-items:center}
.ks-faq summary::-webkit-details-marker{display:none}
.ks-faq summary:after{content:"";flex:none;width:28px;height:28px;border-radius:50%;background:var(--soft) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%233DA829' stroke-width='2.6' stroke-linecap='round'%3E%3Cpath d='M12 5v14M5 12h14'/%3E%3C/svg%3E") center/14px no-repeat;transition:transform .25s}
.ks-faq details[open] summary:after{transform:rotate(45deg)}
.ks-faq p{margin:0 0 18px;line-height:1.7;font-size:15.5px;color:var(--muted)}

/* cta band */
.ks-cta{border-radius:30px;padding:56px 24px;text-align:center;position:relative;overflow:hidden}
.ks-cta .ks-h2{color:#fff;margin-bottom:10px}
.ks-cta p{color:#aab6d6;margin:0 0 26px;font-size:17px}
.ks-cta>:not(.ks-i3d){position:relative;z-index:1}
@media(max-width:640px){.ks-cta{padding:64px 20px 70px}.ks-cta .ks-i3d{width:84px !important;opacity:.6}}

/* footer */
.ks-foot{background:#070c22;color:#8ea0c9;padding:64px 0 calc(28px + env(safe-area-inset-bottom));font-size:14.5px}
.ks-fgrid{display:grid;gap:36px}
@media(min-width:760px){.ks-fgrid{grid-template-columns:1.6fr 1fr 1fr 1fr}}
.ks-foot h4{color:#fff;font-size:14px;margin:0 0 14px;letter-spacing:.02em}
.ks-foot ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.ks-foot a{text-decoration:none;color:#b9c6e8 !important}
.ks-foot a:hover{color:#fff !important}
.ks-soc{display:flex;gap:10px;margin-top:18px}
.ks-soc a{width:40px;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.12);display:inline-flex;align-items:center;justify-content:center;transition:background .2s}
.ks-soc a:hover{background:rgba(255,255,255,.08)}
.ks-soc svg{width:17px;height:17px}
.ks-fbot{margin-top:44px;padding-top:22px;border-top:1px solid rgba(255,255,255,.08);display:flex;flex-wrap:wrap;gap:10px 24px;justify-content:space-between;font-size:13px}
`;

export const SOCIAL_ICON = {
  Instagram: <g fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".7" fill="currentColor" /></g>,
  "X (Twitter)": <path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />,
  Facebook: <path fill="currentColor" d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />,
  LinkedIn: <path fill="currentColor" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />,
};

/** Scroll-reveal (.ks-reveal → .in) and pointer parallax (.ks-scene sets --px/--py) for everything inside the shell. */
function useEffects(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const els = root.querySelectorAll(".ks-reveal");
    let io;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.14, rootMargin: "0px 0px -6% 0px" });
      els.forEach((el) => io.observe(el));
    } else els.forEach((el) => el.classList.add("in"));
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
    const scenes = [...root.querySelectorAll(".ks-scene")];
    let raf = 0;
    const move = (ev) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        for (const s of scenes) {
          const r = s.getBoundingClientRect();
          s.style.setProperty("--px", (((ev.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
          s.style.setProperty("--py", (((ev.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
        }
      });
    };
    if (fine && !reduce && scenes.length) window.addEventListener("pointermove", move, { passive: true });
    return () => { io && io.disconnect(); window.removeEventListener("pointermove", move); if (raf) cancelAnimationFrame(raf); };
  }, [rootRef]);
}

export function useSeo(seo) {
  useEffect(() => {
    if (!seo) return;
    document.title = seo.title;
    const m = document.querySelector('meta[name="description"]');
    if (m) m.setAttribute("content", seo.description);
  }, [seo]);
}

export default function SiteShell({ page, children }) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  useEffects(rootRef);
  const here = typeof window !== "undefined" ? window.location.pathname.replace(/\/+$/, "") : "";
  return (
    <div className="ks" ref={rootRef} data-page={page}>
      <style>{CSS}</style>
      <header className="ks-head">
        <div className="ks-wrap">
          <a className="ks-logo" href="/home">
            <img src="/logo-tp.png" alt="" width="34" height="34" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            <span><b>KudiAI Track</b><small>by Amaya &amp; Co. Technologies</small></span>
          </a>
          <nav className="ks-nav" aria-label="Main">
            {SITE.nav.map(([label, href]) => <a key={href} href={href} aria-current={here === href || here.startsWith(`${href}/`) ? "page" : undefined}>{label}</a>)}
          </nav>
          <div className="ks-acts">
            <a className="ks-signin" href="/">Sign in</a>
            <a className="ks-btn sm" href={SIGNUP}>Get started</a>
          </div>
          <button type="button" className="ks-burger" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
        <div className={`ks-menu${open ? " open" : ""}`}>
          {SITE.nav.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
          <div className="ks-row">
            <a className="ks-btn ghost" href="/">Sign in</a>
            <a className="ks-btn" href={SIGNUP}>Get started</a>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="ks-foot">
        <div className="ks-wrap">
          <div className="ks-fgrid">
            <div>
              <a className="ks-logo" href="/home" style={{ marginBottom: 14 }}>
                <img src="/logo-tp.png" alt="" width="34" height="34" />
                <span><b>KudiAI Track</b><small>by Amaya &amp; Co. Technologies</small></span>
              </a>
              <p style={{ margin: "14px 0 0", maxWidth: 340, lineHeight: 1.6 }}>
                The business, savings and payments app for Nigerian traders, artisans and savings collectors.
              </p>
              <div className="ks-soc">
                {SITE.social.map(([name, handle, href]) => (
                  <a key={name} href={href} target="_blank" rel="noopener noreferrer" aria-label={`KudiAI Track on ${name} (${handle})`} title={`${name} ${handle}`}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">{SOCIAL_ICON[name]}</svg>
                  </a>
                ))}
              </div>
            </div>
            <div><h4>Product</h4><ul>
              <li><a href="/features">Features</a></li><li><a href="/verify">Verify a receipt</a></li><li><a href={SIGNUP}>Create an account</a></li><li><a href="/">Sign in</a></li>
            </ul></div>
            <div><h4>Company</h4><ul>
              <li><a href="/about">About us</a></li><li><a href="/founder">Our founder</a></li><li><a href="/blog">Blog &amp; Insights</a></li><li><a href="/faq">FAQ</a></li><li><a href="/contact">Contact</a></li>
            </ul></div>
            <div><h4>Legal</h4><ul>
              <li><a href="/terms">Terms &amp; Conditions</a></li><li><a href="/privacy">Privacy Policy</a></li><li><a href="/delete-account">Delete an account</a></li>
            </ul></div>
          </div>
          <div className="ks-fbot">
            <span>© {new Date().getFullYear()} Amaya &amp; Co. Technologies. KudiAI Track is a product of Amaya &amp; Co. Technologies.</span>
            <a href="mailto:support@kudiai.app">support@kudiai.app</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── building blocks ─────────────────────────────────────────────────────────────────────────────────────── */

/** A phone in perspective, showing a real app screen. */
export function Phone({ shot, alt, tilt = "rotateY(-16deg) rotateX(6deg)", style, className = "", eager }) {
  return (
    <div className={`ks-phone ${className}`} style={{ transform: tilt, ...style }}>
      <img src={`/shots/${shot}.jpg`} alt={alt} width="540" height="1199" loading={eager ? "eager" : "lazy"} decoding="async" />
    </div>
  );
}

/** One of the 3D renders in public/site/3d. */
export function Icon3D({ name, size = 120, style, className = "", depth }) {
  return (
    <img className={`ks-i3d ${depth ? "ks-par" : ""} ${className}`} src={`/site/3d/${name}.webp`} alt="" width={size} height={size} loading="lazy" decoding="async"
      style={{ width: size, height: "auto", ...(depth ? { "--d": `${depth}px` } : {}), ...style }} />
  );
}

/** Line + area chart that draws itself when revealed. */
export function AreaChart({ points = [12, 18, 15, 24, 22, 31, 38], w = 280, h = 110, color = "#5ED24A", fill = true }) {
  const max = Math.max(...points) * 1.1, step = w / (points.length - 1);
  const xy = points.map((v, i) => [i * step, h - (v / max) * h]);
  const d = xy.map(([x, y], i) => (i ? `L${x.toFixed(1)},${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`)).join(" ");
  const id = `g${color.replace("#", "")}${w}`;
  return (
    <svg className="ks-chart" viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".45" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {fill && <path className="area" d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />}
      <path className="line" d={d} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Bars that grow when revealed. */
export function Bars({ values = [40, 62, 48, 80, 70, 96, 74], labels = ["M", "T", "W", "T", "F", "S", "S"], color = "#3DA829", h = 120 }) {
  const max = Math.max(...values), bw = 100 / values.length;
  return (
    <svg className="ks-bars" viewBox={`0 0 100 ${h + 16}`} width="100%" height={h + 16} preserveAspectRatio="none" aria-hidden="true">
      {values.map((v, i) => {
        const bh = (v / max) * h;
        return (
          <g key={i}>
            <rect x={i * bw + bw * 0.18} y={h - bh} width={bw * 0.64} height={bh} rx="2.2" fill={i === values.length - 2 ? "#E9B949" : color} style={{ transitionDelay: `${i * 70}ms` }} />
            <text x={i * bw + bw / 2} y={h + 13} fontSize="7" textAnchor="middle" fill="currentColor" opacity=".6">{labels[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Progress ring that fills when revealed. */
export function Ring({ pct = 72, size = 92, stroke = 10, color = "#5ED24A", label }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const ref = useRef(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) { setOn(true); return undefined; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect(); } }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <svg ref={ref} className="ks-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth={stroke} />
      <circle className="v" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={on ? c * (1 - pct / 100) : c} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fill="#fff" fontSize={size * 0.22} fontWeight="800">{label ?? `${pct}%`}</text>
    </svg>
  );
}

/** A card that tilts toward the pointer (fine pointers only). */
export function TiltCard({ children, className = "", style, as: Tag = "div", ...rest }) {
  const ref = useRef(null);
  const onMove = (e) => {
    const el = ref.current;
    if (!el || !window.matchMedia("(pointer: fine)").matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${(x * 9).toFixed(2)}deg) rotateX(${(-y * 9).toFixed(2)}deg) translateZ(0)`;
  };
  const onLeave = () => { if (ref.current) ref.current.style.transform = ""; };
  return <Tag ref={ref} className={`ks-tilt ${className}`} style={style} onPointerMove={onMove} onPointerLeave={onLeave} {...rest}>{children}</Tag>;
}

/** Closing call-to-action band. */
export function CtaBand({ title = "Know your numbers. Grow your business.", text = "Start free at kudiai.app. It takes about a minute." }) {
  return (
    <section className="ks-sec" style={{ paddingTop: 0 }}>
      <div className="ks-wrap">
        <div className="ks-cta ks-dark ks-mesh ks-reveal">
          <Icon3D name="coins" size={150} className="ks-float" style={{ left: "-20px", top: "-20px", opacity: 0.95 }} />
          <Icon3D name="wallet" size={150} className="ks-float d2" style={{ right: "-14px", bottom: "-26px" }} />
          <h2 className="ks-h2">{title}</h2>
          <p>{text}</p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <a className="ks-btn" href={SIGNUP}>Get started free →</a>
            <a className="ks-btn ghost" href="/features">See every feature</a>
          </div>
        </div>
      </div>
    </section>
  );
}

/** FAQ accordion from [[q, a], …]. */
export function Faq({ items, openFirst = true }) {
  return (
    <div className="ks-faq">
      {items.map(([q, a], i) => <details key={q} open={openFirst && i === 0}><summary>{q}</summary><p>{a}</p></details>)}
    </div>
  );
}
