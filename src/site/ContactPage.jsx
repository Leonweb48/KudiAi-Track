import { useState } from "react";
import SITE from "../content/site.json";
import SiteShell, { useSeo, Icon3D, TiltCard, SOCIAL_ICON } from "./SiteShell";

/** kudiai.app/contact — email, social handles, quick help, and a message form that opens the visitor's email app. */
const CSS = `
.ct-grid{display:grid;gap:18px;margin-top:-56px;position:relative;z-index:2}
@media(min-width:900px){.ct-grid{grid-template-columns:1.1fr .9fr}}
.ct-mail{display:flex;gap:18px;align-items:center;padding:28px}
.ct-mail img{width:92px;height:auto;filter:drop-shadow(0 14px 18px rgba(15,23,42,.2))}
.ct-mail a.big{display:inline-block;font-size:clamp(20px,2.6vw,28px);font-weight:800;color:var(--ink) !important;text-decoration:none;letter-spacing:-.02em;word-break:break-all}
.ct-soc{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.ct-soc a{display:flex;align-items:center;gap:12px;text-decoration:none;padding:16px;border-radius:18px;border:1px solid var(--line);background:var(--card);transition:border-color .2s,transform .2s}
.ct-soc a:hover{border-color:var(--green);transform:translateY(-2px)}
.ct-soc svg{width:22px;height:22px;color:var(--ink);flex:none}
.ct-soc b{display:block;color:var(--ink);font-size:14.5px}.ct-soc span{color:var(--muted);font-size:13px}
.ct-form{display:grid;gap:12px}
.ct-form label{display:grid;gap:6px;font-size:13px;font-weight:700;color:var(--muted)}
.ct-form input,.ct-form select,.ct-form textarea{font:inherit;font-size:15.5px;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:13px 14px;outline:none;width:100%}
.ct-form input:focus,.ct-form select:focus,.ct-form textarea:focus{border-color:var(--green);box-shadow:0 0 0 4px rgba(61,168,41,.15)}
.ct-help{display:grid;gap:14px}
@media(min-width:760px){.ct-help{grid-template-columns:repeat(3,1fr)}}
.ct-help a{display:block;text-decoration:none}
.ct-help h3{margin:0 0 6px;color:var(--ink);font-size:17px}.ct-help p{margin:0;color:var(--muted);font-size:15px;line-height:1.6}
`;

export default function ContactPage() {
  useSeo(SITE.seo.contact);
  const C = SITE.contact;
  const [f, setF] = useState({ name: "", email: "", topic: "General question", message: "" });
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  const send = (e) => {
    e.preventDefault();
    const subject = `[${f.topic}] ${f.name ? "from " + f.name : "Website message"}`;
    const body = `${f.message}\n\n— ${f.name}${f.email ? ` (${f.email})` : ""}`;
    window.location.href = `mailto:${C.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
  return (
    <SiteShell page="contact">
      <style>{CSS}</style>
      <section className="ks-dark ks-mesh ks-phero" style={{ paddingBottom: 110 }}>
        <div className="ks-wrap">
          <div>
            <h1 className="ks-h1 ks-reveal d1">We’re here <em>to help.</em></h1>
            <p className="ks-reveal d2">{C.lead}</p>
          </div>
          <div className="ks-scene ks-heroart ks-reveal d2" aria-hidden="true">
            <Icon3D name="ai" size={180} depth={-18} className="ks-float" style={{ left: "20%", top: "0" }} />
            <Icon3D name="invoice" size={110} depth={22} className="ks-float d2" style={{ right: "4%", top: "140px" }} />
          </div>
        </div>
      </section>

      <section className="ks-wrap" style={{ paddingBottom: 40 }}>
        <div className="ct-grid">
          <div style={{ display: "grid", gap: 18 }}>
            <div className="ks-card ct-mail ks-reveal">
              <img src="/site/3d/ai.webp" alt="" />
              <div>
                <div className="ks-eyebrow" style={{ marginBottom: 6 }}>Email support</div>
                <a className="big" href={`mailto:${C.email}`}>{C.email}</a>
                <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>For help with your account, the wallet, bills or savings.</p>
              </div>
            </div>
            <div className="ks-card ks-reveal d1">
              <div className="ks-eyebrow">Follow &amp; message us</div>
              <div className="ct-soc">
                {SITE.social.map(([name, handle, href]) => (
                  <a key={name} href={href} target="_blank" rel="noopener noreferrer">
                    <svg viewBox="0 0 24 24" aria-hidden="true">{SOCIAL_ICON[name]}</svg>
                    <div><b>{name}</b><span>{handle}</span></div>
                  </a>
                ))}
              </div>
            </div>
          </div>
          <form className="ks-card ct-form ks-reveal d2" onSubmit={send}>
            <div className="ks-eyebrow" style={{ marginBottom: 0 }}>Send a message</div>
            <label>Your name<input value={f.name} onChange={set("name")} autoComplete="name" maxLength={120} /></label>
            <label>Your email<input type="email" value={f.email} onChange={set("email")} autoComplete="email" maxLength={200} /></label>
            <label>Topic
              <select value={f.topic} onChange={set("topic")}>
                {["General question", "My account", "Wallet & transfers", "Bills & recharge", "Ajo & savings", "Partnership"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label>Message<textarea rows={5} required value={f.message} onChange={set("message")} maxLength={3000} /></label>
            <button className="ks-btn" type="submit" style={{ justifySelf: "start" }}>Open in my email app →</button>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>This opens your email app with the message ready to send to {C.email}.</p>
          </form>
        </div>
      </section>

      <section className="ks-sec" style={{ paddingTop: 40 }}>
        <div className="ks-wrap">
          <div className="ks-eyebrow ks-reveal">Quick help</div>
          <div className="ct-help">
            {C.help.map(([t, d, href], i) => (
              <TiltCard as="a" href={href} className={`ks-card ks-reveal d${i + 1}`} key={t}><h3>{t} →</h3><p>{d}</p></TiltCard>
            ))}
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
