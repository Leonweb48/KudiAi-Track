import { useState } from "react";
import SITE from "../content/site.json";
import SiteShell, { useSeo } from "./SiteShell";
import { LegalContent } from "../screens/LegalScreen";

/** kudiai.app/terms and /privacy inside the website frame. The text is the same published document the app shows. */
const CSS = `
.lg-doc{max-width:860px;margin:-48px auto 0;position:relative;z-index:2;padding:34px 26px}
@media(min-width:760px){.lg-doc{padding:48px 56px}}
.lg-doc .legal-content h2,.lg-doc h2{color:var(--ink);font-weight:800;font-size:20px;letter-spacing:-.01em;margin:34px 0 10px;padding-top:6px}
.lg-doc .legal-content h2:first-child{margin-top:0}
.lg-doc h3{color:var(--ink);font-weight:700;font-size:16.5px;margin:20px 0 8px}
.lg-doc p,.lg-doc li{color:var(--text);font-size:16px;line-height:1.75}
.lg-doc p{margin:0 0 12px}
.lg-doc ul{padding-left:20px;margin:0 0 14px}.lg-doc ol{padding-left:20px;margin:0 0 14px}
.lg-doc a{color:var(--green);text-underline-offset:2px}
.lg-doc table{width:100%;border-collapse:collapse;margin:10px 0 18px;font-size:14.5px}
.lg-doc td,.lg-doc th{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
`;

export default function LegalPage({ type }) {
  const isTerms = type === "terms";
  useSeo(SITE.seo[isTerms ? "terms" : "privacy"]);
  const [meta, setMeta] = useState(null);
  const updated = meta ? new Date(meta.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
  return (
    <SiteShell page={type}>
      <style>{CSS}</style>
      <section className="ks-dark ks-mesh ks-phero" style={{ paddingBottom: 92 }}>
        <div className="ks-wrap" style={{ gridTemplateColumns: "1fr" }}>
          <div>
            <h1 className="ks-h1">{isTerms ? "Terms & Conditions" : "Privacy Policy"}</h1>
            <p>
              {isTerms ? "The rules for using KudiAI Track, a product of Amaya & Co. Technologies." : "How KudiAI Track, a product of Amaya & Co. Technologies, collects, uses and protects your information."}
              {updated && <><br /><span style={{ fontSize: 14, color: "#8ea0c9" }}>Version {meta.version} · Last updated {updated}</span></>}
            </p>
          </div>
        </div>
      </section>
      <section className="ks-wrap" style={{ paddingBottom: 80 }}>
        <article className="ks-card lg-doc">
          <LegalContent type={type} onMeta={setMeta} />
          <p style={{ marginTop: 34, paddingTop: 18, borderTop: "1px solid var(--line)", fontSize: 14, color: "var(--muted)" }}>
            Questions? Email <a href="mailto:support@kudiai.app">support@kudiai.app</a>. See also the {isTerms ? <a href="/privacy">Privacy Policy</a> : <a href="/terms">Terms &amp; Conditions</a>}.
          </p>
        </article>
      </section>
    </SiteShell>
  );
}
