// The blog's Markdown subset, shared by the article page (src/site/BlogPostPage.jsx) and the static page heads
// (scripts/seo-pages.js loads this file by rewriting its one export line, so keep it plain: no imports, one
// "export { … };" line at the end). Supported: "## " / "### " headings, paragraphs,
// "- " and "1. " lists, "> " callout lines (tips, message scripts), pipe tables, **bold** and [links](url). Everything stays text: the page builds
// React elements from it and the static writer escapes it, so nothing in a post can inject HTML.

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

const isTableSep = (row) => /^[\s|:-]+$/.test(row) && row.includes("-");
const cells = (row) => row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** Markdown → [{type:"h2"|"h3", text, id} | {type:"p"|"callout", text} | {type:"ul"|"ol", items} | {type:"table", head, rows}] */
function parseBlocks(md) {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  const seen = new Map();
  let para = [];
  const flush = () => { if (para.length) { blocks.push({ type: "p", text: para.join(" ") }); para = []; } };
  const uniqueId = (text) => {
    const base = slug(text) || "section";
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { flush(); continue; }
    let m = /^(#{2,3})\s+(.*)$/.exec(line);
    if (m) { flush(); blocks.push({ type: m[1].length === 2 ? "h2" : "h3", text: m[2].trim(), id: uniqueId(m[2]) }); continue; }
    m = /^>\s?(.*)$/.exec(line);
    if (m) { flush(); blocks.push({ type: "callout", text: m[1].trim() }); continue; }
    if (/^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      flush();
      const ordered = /^\d/.test(line);
      const re = ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/;
      const items = [];
      while (i < lines.length && re.test(lines[i].trim())) { items.push(lines[i].trim().replace(re, "")); i++; }
      i--;
      blocks.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }
    if (line.startsWith("|")) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(lines[i].trim()); i++; }
      i--;
      const [head, ...rest] = rows;
      blocks.push({ type: "table", head: cells(head), rows: rest.filter((r) => !isTableSep(r)).map(cells) });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

/** Inline text → [{t:"text"|"b", v} | {t:"a", v, href}] (bold and links only). */
function inline(text) {
  const out = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "b", v: m[1] });
    else out.push({ t: "a", v: m[2], href: m[3] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

/** Only absolute http(s) links and site-relative paths are ever turned into links. */
const safeHref = (href) => (/^(https?:\/\/|\/(?!\/))/i.test(String(href || "")) ? href : null);
const isExternal = (href) => /^https?:\/\//i.test(href) && !/^https?:\/\/(www\.)?kudiai\.app(\/|$)/i.test(href);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inlineHtml(text) {
  return inline(text).map((x) => {
    if (x.t === "b") return `<strong>${esc(x.v)}</strong>`;
    if (x.t === "a") {
      const href = safeHref(x.href);
      if (!href) return esc(x.v);
      const abs = href.startsWith("/") ? `https://kudiai.app${href}` : href;
      return `<a href="${esc(abs)}"${isExternal(abs) ? ' rel="noopener"' : ""}>${esc(x.v)}</a>`;
    }
    return esc(x.v);
  }).join("");
}

/** Blocks → static HTML for crawlers (every word escaped). */
function toHtml(blocks) {
  return blocks.map((b) => {
    if (b.type === "h2" || b.type === "h3") return `<${b.type} id="${esc(b.id)}">${inlineHtml(b.text)}</${b.type}>`;
    if (b.type === "p") return `<p>${inlineHtml(b.text)}</p>`;
    if (b.type === "callout") return `<blockquote><p>${inlineHtml(b.text)}</p></blockquote>`;
    if (b.type === "ul" || b.type === "ol") return `<${b.type}>${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join("")}</${b.type}>`;
    if (b.type === "table") {
      return `<table><thead><tr>${b.head.map((c) => `<th>${inlineHtml(c)}</th>`).join("")}</tr></thead>`
        + `<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
    return "";
  }).join("");
}

/** Words in the body, for reading time and the article's wordCount. */
const wordCount = (md) => String(md || "").replace(/[#>*|[\]()-]/g, " ").split(/\s+/).filter(Boolean).length;

export { parseBlocks, inline, safeHref, isExternal, toHtml, wordCount, slug };
