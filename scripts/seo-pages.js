// After `react-scripts build`: give the public marketing pages their own HTML so search engines, link previews and
// AI crawlers (many of which do not run JavaScript) see the right content before the app loads.
//   build/founder.html   — /founder  (content: src/content/founderSeo.json)
//   build/features.html  — /features (content: src/content/features.json)
//   build/llms.txt       — a plain-language summary of KudiAI Track for AI assistants (https://llmstxt.org)
// Each page is the app's index.html with its own title, description, canonical, Open Graph / Twitter tags, schema.org
// JSON-LD and a full text version inside <noscript>; vercel.json rewrites /founder and /features to these files and the
// app then renders the page as usual.
const fs = require("fs");
const path = require("path");

const BUILD = path.join(__dirname, "..", "build");
const founder = require("../src/content/founderSeo.json");
const F = require("../src/content/features.json");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ORG = founder.jsonld["@graph"].find((n) => n["@type"] === "Organization");

const src = fs.readFileSync(path.join(BUILD, "index.html"), "utf8");
if (!/<title>[^<]*<\/title>/.test(src) || !/<meta name="description" content="[^"]*"\s*\/?>/.test(src)) {
  throw new Error("seo-pages: build/index.html has no <title> or meta description to replace");
}

function page({ out, seo, ogType, extraMeta = [], jsonld, noscript }) {
  const head = [
    `<link rel="canonical" href="${esc(seo.url)}"/>`,
    `<meta name="robots" content="index,follow,max-image-preview:large"/>`,
    `<meta property="og:type" content="${ogType}"/>`,
    `<meta property="og:site_name" content="KudiAI Track"/>`,
    `<meta property="og:url" content="${esc(seo.url)}"/>`,
    `<meta property="og:title" content="${esc(seo.title)}"/>`,
    `<meta property="og:description" content="${esc(seo.description)}"/>`,
    `<meta property="og:image" content="${esc(seo.image)}"/>`,
    `<meta property="og:image:alt" content="${esc(seo.imageAlt)}"/>`,
    ...extraMeta,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<meta name="twitter:title" content="${esc(seo.title)}"/>`,
    `<meta name="twitter:description" content="${esc(seo.description)}"/>`,
    `<meta name="twitter:image" content="${esc(seo.image)}"/>`,
    `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>`,   // "<" escaped: the JSON can never close the tag
  ].join("");
  const html = src
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(seo.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(seo.description)}"/>`)
    .replace(/<script type="application\/ld\+json" id="ld-home">[\s\S]*?<\/script>/, "")   // the homepage's own graph
    .replace(/<meta property="og:[^>]*>/g, "").replace(/<meta name="twitter:[^>]*>/g, "")   // the homepage's own share tags
    .replace("</head>", `${head}</head>`)
    .replace(/<noscript>You need to enable JavaScript to run this app\.<\/noscript>/,
      `<noscript><main style="font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;line-height:1.6">${noscript}</main></noscript>`);
  fs.writeFileSync(path.join(BUILD, out), html);
  console.log(`seo-pages: wrote build/${out} (${html.length} bytes)`);
}

// ── /founder ──────────────────────────────────────────────────────────────────────────────────────────────────
page({
  out: "founder.html", seo: founder, ogType: "profile", jsonld: founder.jsonld,
  extraMeta: [`<meta property="profile:first_name" content="Solomon"/>`, `<meta property="profile:last_name" content="Johnson"/>`],
  noscript:
    `<h1>Solomon Leon Johnson</h1><p><b>Founder &amp; CEO, Amaya &amp; Co. Technologies</b>, the company behind <b>KudiAI Track</b>.</p>` +
    `<p>${esc(founder.description)}</p>` +
    `<p>${esc(F.summary)}</p>` +
    `<p><a href="https://kudiai.app/features">See everything KudiAI Track does</a> · <a href="https://kudiai.app/">Open KudiAI Track</a></p>`,
});

// ── /features ─────────────────────────────────────────────────────────────────────────────────────────────────
const featureList = [...F.groups.flatMap((g) => g.items.map(([t]) => t)), ...F.extras.map((x) => x.title)];
page({
  out: "features.html", seo: F.seo, ogType: "website",
  jsonld: {
    "@context": "https://schema.org",
    "@graph": [
      ORG,
      {
        "@type": "SoftwareApplication", "@id": "https://kudiai.app/#app", name: "KudiAI Track",
        alternateName: ["KudiAI", "Kudiai Track", "KudiTrack"],
        applicationCategory: "FinanceApplication", applicationSubCategory: "Business, savings and payments",
        operatingSystem: "Web, Android", url: "https://kudiai.app/", description: F.summary,
        inLanguage: ["en", "pcm", "ha", "ig", "yo"], featureList,
        screenshot: F.groups.map((g) => `https://kudiai.app/shots/${g.shot}.jpg`),
        offers: { "@type": "Offer", price: "0", priceCurrency: "NGN", description: "Free plan available" },
        publisher: { "@id": ORG["@id"] },
      },
      {
        "@type": "WebPage", "@id": F.seo.url, url: F.seo.url, name: F.seo.title, description: F.seo.description, inLanguage: "en-NG",
        about: { "@id": "https://kudiai.app/#app" }, primaryImageOfPage: F.seo.image,
        isPartOf: { "@type": "WebSite", "@id": "https://kudiai.app/#website", name: "KudiAI Track", url: "https://kudiai.app/", publisher: { "@id": ORG["@id"] } },
      },
      {
        "@type": "FAQPage", "@id": `${F.seo.url}#faq`,
        mainEntity: F.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
      },
    ],
  },
  noscript:
    `<h1>KudiAI Track: ${esc(F.hero.title)}</h1><p>${esc(F.hero.lead)}</p><p>${esc(F.summary)}</p>` +
    `<h2>Who it is for</h2><ul>${F.audiences.map((a) => `<li><b>${esc(a.title)}:</b> ${esc(a.text)}</li>`).join("")}</ul>` +
    `<h2>Features</h2>` +
    F.groups.map((g) => `<h3>${esc(g.title)}</h3><p>${esc(g.intro)}</p><ul>${g.items.map(([t, d]) => `<li><b>${esc(t)}:</b> ${esc(d)}</li>`).join("")}</ul>`).join("") +
    `<h3>And more</h3><ul>${F.extras.map((x) => `<li><b>${esc(x.title)}:</b> ${esc(x.text)}</li>`).join("")}</ul>` +
    `<h2>How it works</h2><ol>${F.steps.map(([t, d]) => `<li><b>${esc(t)}:</b> ${esc(d)}</li>`).join("")}</ol>` +
    `<h2>Frequently asked questions</h2>${F.faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}` +
    `<p><a href="https://kudiai.app/">Start free at kudiai.app</a> · <a href="https://kudiai.app/founder">Meet the founder</a> · <a href="https://kudiai.app/verify">Verify a receipt</a></p>`,
});

// ── /llms.txt ─────────────────────────────────────────────────────────────────────────────────────────────────
const llms = [
  "# KudiAI Track",
  "",
  `> ${F.summary}`,
  "",
  "KudiAI Track is made by Amaya & Co. Technologies (also known as Amaya Technologies). Founder & CEO: Solomon Leon Johnson.",
  "Website: https://kudiai.app · Support: support@kudiai.app · Languages: English, Nigerian Pidgin, Hausa, Igbo, Yoruba.",
  "",
  "## Who it is for",
  ...F.audiences.map((a) => `- ${a.title}: ${a.text}`),
  "",
  "## Features",
  ...F.groups.flatMap((g) => ["", `### ${g.title}`, g.intro, ...g.items.map(([t, d]) => `- ${t}: ${d}`)]),
  "",
  "### And more",
  ...F.extras.map((x) => `- ${x.title}: ${x.text}`),
  "",
  "## How it works",
  ...F.steps.map(([t, d], i) => `${i + 1}. ${t}: ${d}`),
  "",
  "## FAQ",
  ...F.faq.flatMap(([q, a]) => [`- Q: ${q}`, `  A: ${a}`]),
  "",
  "## Pages",
  "- [Features](https://kudiai.app/features): everything KudiAI Track does",
  "- [Founder](https://kudiai.app/founder): Solomon Leon Johnson, Founder & CEO of Amaya & Co. Technologies",
  "- [Verify a receipt](https://kudiai.app/verify): check any KudiAI receipt or statement by reference or QR code",
  "- [Privacy Policy](https://kudiai.app/privacy)",
  "- [Terms & Conditions](https://kudiai.app/terms)",
  "- [Delete an account](https://kudiai.app/delete-account)",
  "",
].join("\n");
fs.writeFileSync(path.join(BUILD, "llms.txt"), llms);
console.log(`seo-pages: wrote build/llms.txt (${llms.length} bytes)`);
