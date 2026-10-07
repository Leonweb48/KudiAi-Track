// After `react-scripts build`: give the public website's pages their own HTML so search engines, link previews and
// AI crawlers (many of which do not run JavaScript) see the right content before the app loads.
//   build/{home,features,about,faq,contact,terms,privacy,founder}.html — each is the app's index.html with that page's
//   title, description, canonical, Open Graph / Twitter tags, schema.org JSON-LD and a full text version in <noscript>.
//   build/blog.html and build/blog/<slug>.html — the Blog & Insights list and each article (BlogPosting, breadcrumb, FAQ).
//   build/llms.txt — a plain-language summary of KudiAI Track for AI assistants (https://llmstxt.org).
// vercel.json rewrites /home, /features, … to these files; the app then renders the page as usual.
// Content: src/content/site.json, src/content/features.json, src/content/founderSeo.json, src/content/blog/.
const fs = require("fs");
const path = require("path");

const BUILD = path.join(__dirname, "..", "build");
const founder = require("../src/content/founderSeo.json");
const F = require("../src/content/features.json");
const S = require("../src/content/site.json");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ORG = founder.jsonld["@graph"].find((n) => n["@type"] === "Organization");
const WEBSITE = { "@type": "WebSite", "@id": "https://kudiai.app/#website", name: "KudiAI Track", url: "https://kudiai.app/home", publisher: { "@id": ORG["@id"] } };
const ALL_FAQ = S.faq.flatMap((c) => c.items);
const featureList = [...F.groups.flatMap((g) => g.items.map(([t]) => t)), ...F.extras.map((x) => x.title)];
const APP = {
  "@type": "SoftwareApplication", "@id": "https://kudiai.app/#app", name: "KudiAI Track",
  alternateName: ["KudiAI", "Kudiai Track", "KudiTrack"], applicationCategory: "FinanceApplication",
  applicationSubCategory: "Business, savings and payments", operatingSystem: "Web, Android", url: "https://kudiai.app/home",
  description: F.summary, inLanguage: ["en", "pcm", "ha", "ig", "yo"], featureList,
  screenshot: F.groups.map((g) => `https://kudiai.app/shots/${g.shot}.jpg`),
  offers: { "@type": "Offer", price: "0", priceCurrency: "NGN", description: "Free plan available" },
  publisher: { "@id": ORG["@id"] },
};
const faqPage = (id, items) => ({ "@type": "FAQPage", "@id": id, mainEntity: items.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
// A page's share image: every /og/ card is 1200x630 (made from the photos in public/site/people).
const imageSize = (url) => (/\/og\/[a-z-]+\.jpg$/.test(url || "") ? { width: 1200, height: 630 } : null);
const imageObject = (seo) => ({ "@type": "ImageObject", url: seo.image, contentUrl: seo.image, caption: seo.imageAlt, ...(imageSize(seo.image) || {}) });
const webPage = (type, seo, extra = {}) => ({ "@type": type, "@id": seo.url, url: seo.url, name: seo.title, description: seo.description, inLanguage: "en-NG", isPartOf: { "@id": WEBSITE["@id"] }, image: imageObject(seo), primaryImageOfPage: imageObject(seo), ...extra });
const list = (rows) => `<ul>${rows.map(([t, d]) => `<li><b>${esc(t)}:</b> ${esc(d)}</li>`).join("")}</ul>`;
const NAV = `<p><a href="https://kudiai.app/home">Home</a> · <a href="https://kudiai.app/features">Features</a> · <a href="https://kudiai.app/about">About</a> · <a href="https://kudiai.app/blog">Blog</a> · <a href="https://kudiai.app/faq">FAQ</a> · <a href="https://kudiai.app/contact">Contact</a> · <a href="https://kudiai.app/">Sign in</a></p>`;

const src = fs.readFileSync(path.join(BUILD, "index.html"), "utf8");
if (!/<title>[^<]*<\/title>/.test(src) || !/<meta name="description" content="[^"]*"\s*\/?>/.test(src)) {
  throw new Error("seo-pages: build/index.html has no <title> or meta description to replace");
}

function page({ out, seo, ogType = "website", extraMeta = [], jsonld, noscript }) {
  const head = [
    `<link rel="canonical" href="${esc(seo.url)}"/>`,
    `<meta name="robots" content="index,follow,max-image-preview:large"/>`,
    `<meta property="og:type" content="${ogType}"/>`,
    `<meta property="og:site_name" content="KudiAI Track"/>`,
    `<meta property="og:url" content="${esc(seo.url)}"/>`,
    `<meta property="og:title" content="${esc(seo.title)}"/>`,
    `<meta property="og:description" content="${esc(seo.description)}"/>`,
    `<meta property="og:image" content="${esc(seo.image)}"/>`,
    `<meta property="og:image:secure_url" content="${esc(seo.image)}"/>`,
    `<meta property="og:image:type" content="${/\.png$/i.test(seo.image) ? "image/png" : "image/jpeg"}"/>`,
    ...(imageSize(seo.image) ? [`<meta property="og:image:width" content="1200"/>`, `<meta property="og:image:height" content="630"/>`] : []),
    `<meta property="og:image:alt" content="${esc(seo.imageAlt)}"/>`,
    ...extraMeta,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<meta name="twitter:title" content="${esc(seo.title)}"/>`,
    `<meta name="twitter:description" content="${esc(seo.description)}"/>`,
    `<meta name="twitter:image" content="${esc(seo.image)}"/>`,
    `<meta name="twitter:image:alt" content="${esc(seo.imageAlt)}"/>`,
    `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>`,   // "<" escaped: the JSON can never close the tag
  ].join("");
  const html = src
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(seo.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(seo.description)}"/>`)
    .replace(/<script type="application\/ld\+json" id="ld-home">[\s\S]*?<\/script>/, "")   // the sign-in page's own graph
    .replace(/<meta property="og:[^>]*>/g, "").replace(/<meta name="twitter:[^>]*>/g, "")   // the sign-in page's own share tags
    .replace("</head>", `${head}</head>`)
    .replace(/<noscript>You need to enable JavaScript to run this app\.<\/noscript>/,
      `<noscript><main style="font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;line-height:1.6">${NAV}${noscript}</main></noscript>`);
  fs.writeFileSync(path.join(BUILD, out), html);
  console.log(`seo-pages: wrote build/${out} (${html.length} bytes)`);
}

const graph = (...nodes) => ({ "@context": "https://schema.org", "@graph": [ORG, WEBSITE, ...nodes] });
const H = S.home;

// ── /home ─────────────────────────────────────────────────────────────────────────────────────────────────────
page({
  out: "home.html", seo: S.seo.home,
  jsonld: graph(APP, webPage("WebPage", S.seo.home, { about: { "@id": APP["@id"] } }), faqPage(`${S.seo.home.url}#faq`, ALL_FAQ.slice(0, 6))),
  noscript:
    `<h1>KudiAI Track: ${esc(H.title)}</h1><p>${esc(H.lead)}</p><p>${esc(F.summary)}</p>` +
    `<h2>Everything in one app</h2>${list(H.bento.map(([, t, d]) => [t, d]))}` +
    `<h2>${esc(H.profit.title)}</h2><p>${esc(H.profit.text)}</p>` +
    `<h2>${esc(H.flow.title)}</h2><p>${esc(H.flow.text)}</p>` +
    `<h2>${esc(H.ajo.title)}</h2><p>${esc(H.ajo.text)}</p>` +
    `<h2>${esc(H.security.title)}</h2>${list(H.security.points)}` +
    `<h2>Who it is for</h2>${list(F.audiences.map((a) => [a.title, a.text]))}` +
    `<p>KudiAI Track is made by Amaya &amp; Co. Technologies. <a href="https://kudiai.app/?signup=1">Get started free</a>.</p>`,
});

// ── /features ─────────────────────────────────────────────────────────────────────────────────────────────────
page({
  out: "features.html", seo: F.seo,
  jsonld: graph(APP, webPage("WebPage", F.seo, { about: { "@id": APP["@id"] } }), faqPage(`${F.seo.url}#faq`, ALL_FAQ.slice(0, 8))),
  noscript:
    `<h1>KudiAI Track features: ${esc(F.hero.title)}</h1><p>${esc(F.hero.lead)}</p><p>${esc(F.summary)}</p>` +
    F.groups.map((g) => `<h2>${esc(g.title)}</h2><p>${esc(g.intro)}</p>${list(g.items)}`).join("") +
    `<h2>And more</h2>${list(F.extras.map((x) => [x.title, x.text]))}` +
    `<h2>How it works</h2><ol>${F.steps.map(([t, d]) => `<li><b>${esc(t)}:</b> ${esc(d)}</li>`).join("")}</ol>`,
});

// ── /about ────────────────────────────────────────────────────────────────────────────────────────────────────
const A = S.about;
page({
  out: "about.html", seo: S.seo.about,
  jsonld: graph(APP, webPage("AboutPage", S.seo.about, { about: { "@id": ORG["@id"] }, mainEntity: { "@id": ORG["@id"] } })),
  noscript:
    `<h1>About KudiAI Track and Amaya &amp; Co. Technologies</h1><p>${esc(A.lead)}</p>${A.story.map((p) => `<p>${esc(p)}</p>`).join("")}` +
    `<h2>Our mission</h2><p>${esc(A.mission)}</p><h2>Our vision</h2><p>${esc(A.vision)}</p>` +
    `<h2>Our values</h2>${list(A.values)}` +
    `<h2>Our founder</h2><p>Solomon Leon Johnson, Founder &amp; CEO. <a href="https://kudiai.app/founder">Read the founder's note</a>.</p>`,
});

// ── /faq ──────────────────────────────────────────────────────────────────────────────────────────────────────
page({
  out: "faq.html", seo: S.seo.faq,
  jsonld: graph(webPage("WebPage", S.seo.faq, { about: { "@id": APP["@id"] } }), faqPage(`${S.seo.faq.url}#faq`, ALL_FAQ)),
  noscript: `<h1>KudiAI Track: frequently asked questions</h1>` +
    S.faq.map((c) => `<h2>${esc(c.cat)}</h2>${c.items.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}`).join(""),
});

// ── /contact ──────────────────────────────────────────────────────────────────────────────────────────────────
page({
  out: "contact.html", seo: S.seo.contact,
  jsonld: {
    "@context": "https://schema.org",
    "@graph": [
      { ...ORG, contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: S.contact.email, availableLanguage: ["English"] }, sameAs: S.social.map((s) => s[2]) },
      WEBSITE,
      webPage("ContactPage", S.seo.contact, { mainEntity: { "@id": ORG["@id"] } }),
    ],
  },
  noscript:
    `<h1>Contact KudiAI Track</h1><p>${esc(S.contact.lead)}</p><p>Email: <a href="mailto:${esc(S.contact.email)}">${esc(S.contact.email)}</a></p>` +
    `<ul>${S.social.map(([n, h, u]) => `<li>${esc(n)}: <a href="${esc(u)}">${esc(h)}</a></li>`).join("")}</ul>` +
    `<h2>Quick help</h2>${list(S.contact.help.map(([t, d]) => [t, d]))}`,
});

// ── /terms and /privacy (the text itself is loaded by the app from the published legal documents) ──────────────
for (const t of ["terms", "privacy"]) {
  page({
    out: `${t}.html`, seo: S.seo[t], jsonld: graph(webPage("WebPage", S.seo[t])),
    noscript: `<h1>${t === "terms" ? "Terms &amp; Conditions" : "Privacy Policy"}</h1><p>${esc(S.seo[t].description)} Questions: support@kudiai.app.</p>`,
  });
}

// ── /founder ──────────────────────────────────────────────────────────────────────────────────────────────────
page({
  out: "founder.html", seo: founder, ogType: "profile", jsonld: founder.jsonld,
  extraMeta: [`<meta property="profile:first_name" content="Solomon"/>`, `<meta property="profile:last_name" content="Johnson"/>`],
  noscript:
    `<h1>Solomon Leon Johnson</h1><p><b>Founder &amp; CEO, Amaya &amp; Co. Technologies</b>, the company behind <b>KudiAI Track</b>.</p>` +
    `<p>${esc(founder.description)}</p><p>${esc(F.summary)}</p>`,
});

// ── /blog and /blog/<slug> (Blog & Insights) ──────────────────────────────────────────────────────────────────
// The list of articles is src/content/blog/index.json; each article's words are src/content/blog/posts/<slug>.json.
// src/site/blog/md.js is an ES module (the app bundles it too): load it here by turning its one export line into module.exports.
const md = (() => {
  const code = fs.readFileSync(path.join(__dirname, "..", "src", "site", "blog", "md.js"), "utf8")
    .replace(/^export \{([^}]+)\};?\s*$/m, "module.exports = {$1};");
  if (/^\s*(import|export)\s/m.test(code)) throw new Error("seo-pages: src/site/blog/md.js must have no imports and one export { ... } line");
  const m = { exports: {} };
  new Function("module", "exports", code)(m, m.exports);   // eslint-disable-line no-new-func
  return m.exports;
})();
const BLOG = require("../src/content/blog/index.json");
const abs = (u) => (String(u).startsWith("/") ? `https://kudiai.app${u}` : u);
const postUrl = (p) => `https://kudiai.app/blog/${p.slug}`;
const BLOG_ID = `${BLOG.seo.url}#blog`;
fs.mkdirSync(path.join(BUILD, "blog"), { recursive: true });

page({
  out: "blog.html", seo: BLOG.seo,
  jsonld: graph(
    webPage("CollectionPage", BLOG.seo, {
      mainEntity: { "@type": "ItemList", itemListElement: BLOG.posts.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: postUrl(p), name: p.title })) },
    }),
    { "@type": "Blog", "@id": BLOG_ID, name: "KudiAI Track Blog & Insights", url: BLOG.seo.url, description: BLOG.seo.description, inLanguage: "en-NG",
      publisher: { "@id": ORG["@id"] }, blogPost: BLOG.posts.map((p) => ({ "@id": `${postUrl(p)}#article` })) },
  ),
  noscript: `<h1>KudiAI Track Blog &amp; Insights</h1><p>${esc(BLOG.intro)}</p>` +
    `<ul>${BLOG.posts.map((p) => `<li><a href="${postUrl(p)}">${esc(p.title)}</a>: ${esc(p.description)}</li>`).join("")}</ul>`,
});

for (const p of BLOG.posts) {
  const c = require(`../src/content/blog/posts/${p.slug}.json`);
  const blocks = md.parseBlocks(c.body);
  const seo = { url: postUrl(p), title: `${p.seoTitle} | KudiAI Track`, description: p.description, image: p.og, imageAlt: p.imageAlt };
  const modified = p.updated || p.date;
  const article = {
    "@type": "BlogPosting", "@id": `${seo.url}#article`, url: seo.url, headline: p.title, description: p.description,
    image: [imageObject(seo), { "@type": "ImageObject", url: abs(p.image), contentUrl: abs(p.image), caption: p.imageAlt, width: 1600, height: 900 }],
    datePublished: p.date, dateModified: modified,
    author: { "@type": "Organization", name: "KudiAI Track team", url: "https://kudiai.app/about" },
    publisher: { "@id": ORG["@id"] }, mainEntityOfPage: { "@id": seo.url }, isPartOf: { "@id": BLOG_ID },
    articleSection: p.category, keywords: p.keywords.join(", "), wordCount: md.wordCount(c.body), inLanguage: "en-NG",
  };
  const crumbs = {
    "@type": "BreadcrumbList", "@id": `${seo.url}#breadcrumb`,
    itemListElement: [["Home", "https://kudiai.app/home"], ["Blog & Insights", BLOG.seo.url], [p.title, seo.url]]
      .map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })),
  };
  const nodes = [webPage("WebPage", seo, { breadcrumb: { "@id": crumbs["@id"] }, mainEntity: { "@id": article["@id"] }, datePublished: p.date, dateModified: modified }), article, crumbs];
  if (c.faq && c.faq.length) nodes.push(faqPage(`${seo.url}#faq`, c.faq));
  page({
    out: `blog/${p.slug}.html`, seo, ogType: "article", jsonld: graph(...nodes),
    extraMeta: [
      `<meta property="article:published_time" content="${esc(p.date)}"/>`,
      `<meta property="article:modified_time" content="${esc(modified)}"/>`,
      `<meta property="article:section" content="${esc(p.category)}"/>`,
      ...p.keywords.map((k) => `<meta property="article:tag" content="${esc(k)}"/>`),
    ],
    noscript:
      `<p><a href="${BLOG.seo.url}">Blog &amp; Insights</a> / ${esc(p.category)}</p>` +
      `<article><h1>${esc(p.title)}</h1><p>${esc(p.description)}</p><p>By the KudiAI Track team · ${esc(p.date.slice(0, 10))} · ${p.readMinutes} min read</p>` +
      `<img src="${esc(abs(p.image))}" alt="${esc(p.imageAlt)}" width="1600" height="900"/>` +
      md.toHtml(blocks) +
      (c.faq && c.faq.length ? `<h2>Questions people ask</h2>${c.faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}` : "") +
      (c.sources && c.sources.length ? `<h2>Sources</h2><ol>${c.sources.filter(([, u]) => md.safeHref(u)).map(([n, u]) => `<li><a href="${esc(u)}" rel="noopener">${esc(n)}</a></li>`).join("")}</ol>` : "") +
      `</article>`,
  });
}

// ── /llms.txt ─────────────────────────────────────────────────────────────────────────────────────────────────
const llms = [
  "# KudiAI Track",
  "",
  `> ${F.summary}`,
  "",
  "KudiAI Track is made by Amaya & Co. Technologies (also known as Amaya Technologies). Founder & CEO: Solomon Leon Johnson.",
  `Website: https://kudiai.app/home · Sign in: https://kudiai.app · Support: ${S.contact.email} · Languages: English, Nigerian Pidgin, Hausa, Igbo, Yoruba.`,
  `Social: ${S.social.map(([n, h]) => `${n} ${h}`).join(" · ")}`,
  "",
  "## Mission",
  A.mission,
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
  ...S.faq.flatMap((c) => ["", `### ${c.cat}`, ...c.items.flatMap(([q, a]) => [`- Q: ${q}`, `  A: ${a}`])]),
  "",
  "## Pages",
  "- [Home](https://kudiai.app/home)",
  "- [Features](https://kudiai.app/features): everything KudiAI Track does",
  "- [About](https://kudiai.app/about): Amaya & Co. Technologies, mission, vision and values",
  "- [FAQ](https://kudiai.app/faq)",
  "- [Contact](https://kudiai.app/contact)",
  "- [Founder](https://kudiai.app/founder): Solomon Leon Johnson, Founder & CEO",
  "- [Blog & Insights](https://kudiai.app/blog): practical guides for Nigerian small businesses",
  "- [Verify a receipt](https://kudiai.app/verify): check any KudiAI receipt or statement by reference or QR code",
  "- [Privacy Policy](https://kudiai.app/privacy) · [Terms & Conditions](https://kudiai.app/terms) · [Delete an account](https://kudiai.app/delete-account)",
  "",
  "## Blog & Insights",
  ...BLOG.posts.map((p) => `- [${p.title}](${postUrl(p)}): ${p.description}`),
  "",
].join("\n");
fs.writeFileSync(path.join(BUILD, "llms.txt"), llms);
console.log(`seo-pages: wrote build/llms.txt (${llms.length} bytes)`);
