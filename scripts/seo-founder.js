// After `react-scripts build`: write build/founder.html — the app's index.html with the founder page's own <head>
// (title, description, canonical, Open Graph / Twitter card, schema.org JSON-LD) and a plain-text summary for crawlers
// that do not run JavaScript. vercel.json rewrites /founder to it, so search engines and link previews see the right page
// before the app loads; the app itself then renders the founder page as usual. Content comes from src/content/founderSeo.json.
const fs = require("fs");
const path = require("path");

const BUILD = path.join(__dirname, "..", "build");
const seo = require("../src/content/founderSeo.json");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const src = fs.readFileSync(path.join(BUILD, "index.html"), "utf8");
if (!/<title>[^<]*<\/title>/.test(src) || !/<meta name="description" content="[^"]*"\s*\/?>/.test(src)) {
  throw new Error("seo-founder: build/index.html has no <title> or meta description to replace");
}

const head = [
  `<link rel="canonical" href="${esc(seo.url)}"/>`,
  `<meta name="robots" content="index,follow,max-image-preview:large"/>`,
  `<meta property="og:type" content="profile"/>`,
  `<meta property="og:site_name" content="KudiAI Track"/>`,
  `<meta property="og:url" content="${esc(seo.url)}"/>`,
  `<meta property="og:title" content="${esc(seo.title)}"/>`,
  `<meta property="og:description" content="${esc(seo.description)}"/>`,
  `<meta property="og:image" content="${esc(seo.image)}"/>`,
  `<meta property="og:image:alt" content="${esc(seo.imageAlt)}"/>`,
  `<meta property="profile:first_name" content="Solomon"/>`,
  `<meta property="profile:last_name" content="Johnson"/>`,
  `<meta name="twitter:card" content="summary_large_image"/>`,
  `<meta name="twitter:title" content="${esc(seo.title)}"/>`,
  `<meta name="twitter:description" content="${esc(seo.description)}"/>`,
  `<meta name="twitter:image" content="${esc(seo.image)}"/>`,
  // "<" escaped so the JSON can never close the script tag
  `<script type="application/ld+json">${JSON.stringify(seo.jsonld).replace(/</g, "\\u003c")}</script>`,
].join("");

const noscript =
  `<noscript><main style="font-family:Georgia,serif;max-width:680px;margin:40px auto;padding:0 16px;line-height:1.6">` +
  `<h1>Solomon Leon Johnson</h1><p><b>Founder &amp; CEO, Amaya &amp; Co. Technologies</b>, the company behind <b>KudiAI Track</b>.</p>` +
  `<p>${esc(seo.description)}</p>` +
  `<p>KudiAI Track helps Nigerian traders, artisans and Ajo collectors record sales, see real profit, manage stock and debts, run Ajo and Esusu savings, and pay bills — in English, Pidgin, Hausa, Igbo or Yoruba.</p>` +
  `<p><a href="https://kudiai.app/">Open KudiAI Track</a></p></main></noscript>`;

let out = src
  .replace(/<title>[^<]*<\/title>/, `<title>${esc(seo.title)}</title>`)
  .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(seo.description)}"/>`)
  .replace(/<script type="application\/ld\+json" id="ld-home">[\s\S]*?<\/script>/, "")   // the homepage's own graph, if present
  .replace(/<meta property="og:[^>]*>/g, "").replace(/<meta name="twitter:[^>]*>/g, "")   // the homepage's own share tags
  .replace("</head>", `${head}</head>`)
  .replace(/<noscript>You need to enable JavaScript to run this app\.<\/noscript>/, noscript);

fs.writeFileSync(path.join(BUILD, "founder.html"), out);
console.log(`seo-founder: wrote build/founder.html (${out.length} bytes)`);
