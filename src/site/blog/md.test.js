import { parseBlocks, inline, safeHref, isExternal, toHtml, wordCount } from "./md";
const fs = require("fs");
const path = require("path");
const BLOG = require("../../content/blog/index.json");

const ROOT = path.join(__dirname, "..", "..", "..");
const JS_URL = ["javascript", "alert(1)"].join(":");   // built up so the linter does not flag a script URL

describe("blog markdown subset", () => {
  test("headings get unique ids, paragraphs join their lines", () => {
    const b = parseBlocks("## How much?\nline one\nline two\n\n## How much?\n### Sub **bold**");
    expect(b).toEqual([
      { type: "h2", text: "How much?", id: "how-much" },
      { type: "p", text: "line one line two" },
      { type: "h2", text: "How much?", id: "how-much-2" },
      { type: "h3", text: "Sub **bold**", id: "sub-bold" },
    ]);
  });

  test("lists, callouts and tables", () => {
    const b = parseBlocks("- a\n- b\n\n1. one\n2. two\n> Say this.\n| A | B |\n| --- | --- |\n| ₦1,000 | x |\n| ₦2,000 | y |");
    expect(b).toEqual([
      { type: "ul", items: ["a", "b"] },
      { type: "ol", items: ["one", "two"] },
      { type: "callout", text: "Say this." },
      { type: "table", head: ["A", "B"], rows: [["₦1,000", "x"], ["₦2,000", "y"]] },
    ]);
  });

  test("inline bold and links", () => {
    expect(inline("Pay **₦500** at [CAC](https://www.cac.gov.ng/) now")).toEqual([
      { t: "text", v: "Pay " }, { t: "b", v: "₦500" }, { t: "text", v: " at " },
      { t: "a", v: "CAC", href: "https://www.cac.gov.ng/" }, { t: "text", v: " now" },
    ]);
  });

  test("only http(s) and site paths become links", () => {
    expect(safeHref("https://nbs.gov.ng/x")).toBe("https://nbs.gov.ng/x");
    expect(safeHref("/blog/x")).toBe("/blog/x");
    expect(safeHref(JS_URL)).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(isExternal("https://kudiai.app/blog")).toBe(false);
    expect(isExternal("https://cac.gov.ng")).toBe(true);
  });

  test("static HTML escapes everything and absolutises site links", () => {
    const html = toHtml(parseBlocks('## <script>\nA [x](/blog/a) and [y](https://cac.gov.ng) "q" [z](javascript:alert(1))\n> <b>hi</b>'));
    expect(html).toContain('<h2 id="script">&lt;script&gt;</h2>');
    expect(html).toContain('<a href="https://kudiai.app/blog/a">x</a>');
    expect(html).toContain('<a href="https://cac.gov.ng" rel="noopener">y</a>');
    expect(html).toContain("&quot;q&quot;");
    expect(html).not.toContain(JS_URL.slice(0, 11));
    expect(html).toContain("<blockquote><p>&lt;b&gt;hi&lt;/b&gt;</p></blockquote>");
  });

  test("word count ignores markdown symbols", () => {
    expect(wordCount("## Two words\n- **three** [four](https://x.y)")).toBe(5);
  });
});

describe("blog content", () => {
  const slugs = new Set(BLOG.posts.map((p) => p.slug));

  test.each(BLOG.posts.map((p) => [p.slug, p]))("%s is complete", (slug, p) => {
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(p.seoTitle.length).toBeLessThanOrEqual(60);
    expect(p.description.length).toBeGreaterThanOrEqual(110);
    expect(p.description.length).toBeLessThanOrEqual(165);
    expect(["Guides", "Insights"]).toContain(p.category);
    expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(p.updated).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(fs.existsSync(path.join(ROOT, "public", p.image))).toBe(true);
    expect(p.og).toBe(`https://kudiai.app/og/blog-${slug}.jpg`);
    expect(fs.existsSync(path.join(ROOT, "public", "og", `blog-${slug}.jpg`))).toBe(true);

    const c = require(`../../content/blog/posts/${slug}.json`);
    const blocks = parseBlocks(c.body);
    expect(blocks.filter((b) => b.type === "h2").length).toBeGreaterThanOrEqual(4);
    expect(c.body).not.toMatch(/<[a-z/]/i);   // no raw HTML in a post
    expect(c.faq.length).toBeGreaterThanOrEqual(3);
    c.faq.forEach((f) => expect(f).toHaveLength(2));
    expect(c.sources.length).toBeGreaterThanOrEqual(1);
    c.sources.forEach(([, u]) => expect(u).toMatch(/^https:\/\//));
    // every link is safe, and links to other articles point at articles that exist
    for (const m of c.body.matchAll(/\]\(([^)\s]+)\)/g)) {
      expect(safeHref(m[1])).not.toBeNull();
      const own = /^(?:https:\/\/kudiai\.app)?\/blog\/([a-z0-9-]+)/.exec(m[1]);
      if (own) expect(slugs.has(own[1])).toBe(true);
    }
  });
});
