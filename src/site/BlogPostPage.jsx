import { useEffect, useMemo, useState } from "react";
import BLOG from "../content/blog/index.json";
import SiteShell, { useSeo, CtaBand, Faq } from "./SiteShell";
import { parseBlocks, inline, safeHref, isExternal } from "./blog/md";
import { BLOG_CSS, PostCard, longDate } from "./BlogPage";

/** kudiai.app/blog/<slug> — one article. The words load per article; the list of articles is in content/blog/index.json. */
const CSS = `
.bp-hero{padding:46px 0 120px}
@media(min-width:900px){.bp-hero{padding:64px 0 150px}}
.bp-hero .ks-wrap{max-width:860px}
.bp-crumb{font-size:13.5px;font-weight:700;color:#9fb0d9;margin-bottom:18px}
.bp-crumb a{color:#bff5b3;text-decoration:none}
.bp-hero h1{font-size:clamp(30px,4.6vw,48px);line-height:1.08;font-weight:800;letter-spacing:-.03em;color:#fff;margin:10px 0 16px}
.bp-lede{font-size:clamp(16.5px,1.8vw,19px);line-height:1.6;color:#b3c0e0;margin:0 0 20px}
.bp-meta{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13.5px;color:#9fb0d9;font-weight:600}
.bp-wrap{max-width:860px;margin:-96px auto 0;padding:0 16px;position:relative;z-index:2}
.bp-img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:24px;box-shadow:0 40px 80px -40px rgba(11,20,55,.55);background:#e2e8f0}
.bp-col{max-width:720px;margin:0 auto}
.bp-toc{margin:30px 0 8px;padding:18px 20px;border:1px solid var(--line);border-radius:18px;background:var(--card)}
.bp-toc b{display:block;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.bp-toc ol{margin:0;padding-left:20px;display:grid;gap:6px}
.bp-toc a{color:var(--ink);text-decoration:none;font-weight:600;font-size:15px}
.bp-body{font-size:17.5px;line-height:1.75;color:var(--text);margin-top:28px}
.bp-body h2{font-size:clamp(23px,2.6vw,28px);line-height:1.2;font-weight:800;letter-spacing:-.02em;color:var(--ink);margin:42px 0 12px;scroll-margin-top:90px}
.bp-body h3{font-size:20px;line-height:1.3;font-weight:800;color:var(--ink);margin:28px 0 8px;scroll-margin-top:90px}
.bp-body p{margin:0 0 18px}
.bp-body ul,.bp-body ol{margin:0 0 20px;padding-left:24px;display:grid;gap:8px}
.bp-body strong{color:var(--ink)}
.bp-body a{color:var(--green);font-weight:700;text-underline-offset:3px}
.bp-body blockquote{margin:20px 0 24px;padding:16px 18px 16px 20px;border-left:4px solid var(--green);border-radius:0 16px 16px 0;background:var(--soft);font-size:16.5px;line-height:1.65;color:var(--ink)}
.bp-table{overflow-x:auto;margin:6px 0 24px;border:1px solid var(--line);border-radius:16px}
.bp-table table{border-collapse:collapse;width:100%;font-size:15.5px}
.bp-table table.wide{min-width:540px}
@media(max-width:560px){.bp-table table{font-size:14.5px}.bp-table th,.bp-table td{padding:10px 11px}}
.bp-table th{background:var(--soft);color:var(--ink);text-align:left;font-weight:800;padding:12px 14px}
.bp-table td{padding:11px 14px;border-top:1px solid var(--line)}
.bp-share{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:36px 0 0;padding-top:24px;border-top:1px solid var(--line)}
.bp-share span{font-weight:700;color:var(--ink);margin-right:4px}
.bp-share a,.bp-share button{font:inherit;font-size:14px;font-weight:700;padding:9px 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink);text-decoration:none;cursor:pointer}
.bp-src{margin-top:34px;font-size:14.5px;color:var(--muted)}
.bp-src h2{font-size:18px;color:var(--ink);margin:0 0 10px}
.bp-src ol{padding-left:20px;margin:0;display:grid;gap:6px}
.bp-src a{color:var(--muted);word-break:break-word}
.bp-note{font-size:14px;color:var(--muted);margin-top:22px;line-height:1.6}
.bp-skel{height:14px;border-radius:7px;background:var(--line);margin:14px 0;opacity:.6}
`;

function Inline({ text }) {
  return inline(text).map((x, i) => {
    if (x.t === "b") return <strong key={i}>{x.v}</strong>;
    if (x.t === "a") {
      const href = safeHref(x.href);
      if (!href) return <span key={i}>{x.v}</span>;
      return isExternal(href)
        ? <a key={i} href={href} target="_blank" rel="noopener noreferrer">{x.v}</a>
        : <a key={i} href={href}>{x.v}</a>;
    }
    return <span key={i}>{x.v}</span>;
  });
}

function Block({ b }) {
  if (b.type === "h2") return <h2 id={b.id}><Inline text={b.text} /></h2>;
  if (b.type === "h3") return <h3 id={b.id}><Inline text={b.text} /></h3>;
  if (b.type === "p") return <p><Inline text={b.text} /></p>;
  if (b.type === "callout") return <blockquote><Inline text={b.text} /></blockquote>;
  if (b.type === "ul") return <ul>{b.items.map((it, i) => <li key={i}><Inline text={it} /></li>)}</ul>;
  if (b.type === "ol") return <ol>{b.items.map((it, i) => <li key={i}><Inline text={it} /></li>)}</ol>;
  if (b.type === "table") {
    return (
      <div className="bp-table"><table className={b.head.length >= 4 ? "wide" : undefined}>
        <thead><tr>{b.head.map((c, i) => <th key={i}><Inline text={c} /></th>)}</tr></thead>
        <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, i) => <td key={i}><Inline text={c} /></td>)}</tr>)}</tbody>
      </table></div>
    );
  }
  return null;
}

export default function BlogPostPage({ slug }) {
  const post = BLOG.posts.find((p) => p.slug === slug);
  const [content, setContent] = useState(null);   // { body, faq, sources } — null while loading, false if missing
  const seo = useMemo(() => (post ? { title: `${post.seoTitle} | KudiAI Track`, description: post.description } : { title: "Article not found | KudiAI Track", description: "" }), [post]);
  useSeo(seo);

  useEffect(() => {
    if (!post) return undefined;
    let live = true;
    import(`../content/blog/posts/${post.slug}.json`)
      .then((m) => { if (live) setContent(m.default || m); })
      .catch(() => { if (live) setContent(false); });
    return () => { live = false; };
  }, [post]);

  const blocks = useMemo(() => (content ? parseBlocks(content.body) : []), [content]);
  const toc = blocks.filter((b) => b.type === "h2");
  const related = useMemo(() => {
    if (!post) return [];
    const others = BLOG.posts.filter((p) => p.slug !== post.slug);
    return [...others.filter((p) => p.category === post.category), ...others.filter((p) => p.category !== post.category)].slice(0, 3);
  }, [post]);

  if (!post) {
    return (
      <SiteShell page="blog">
        <style>{BLOG_CSS + CSS}</style>
        <section className="ks-dark ks-mesh bp-hero" style={{ paddingBottom: 90 }}>
          <div className="ks-wrap">
            <div className="bp-crumb"><a href="/blog">Blog &amp; Insights</a></div>
            <h1>We couldn't find that article.</h1>
            <p className="bp-lede">It may have moved. All our guides and insights are on the blog.</p>
            <a className="ks-btn" href="/blog">Go to the blog →</a>
          </div>
        </section>
      </SiteShell>
    );
  }

  const url = `https://kudiai.app/blog/${post.slug}`;
  const share = encodeURIComponent(`${post.title} ${url}`);
  const copy = () => { try { navigator.clipboard.writeText(url); } catch { /* clipboard blocked: the link is in the address bar */ } };

  return (
    <SiteShell page="blog">
      <style>{BLOG_CSS + CSS}</style>
      <section className="ks-dark ks-mesh bp-hero">
        <div className="ks-wrap">
          <div className="bp-crumb ks-reveal"><a href="/blog">Blog &amp; Insights</a> / <a href={`/blog?category=${post.category}`}>{post.category}</a></div>
          <h1 className="ks-reveal d1">{post.title}</h1>
          <p className="bp-lede ks-reveal d2">{post.description}</p>
          <div className="bp-meta ks-reveal d2">
            <span>By the KudiAI Track team</span><span>{longDate(post.date)}</span><span>{post.readMinutes} min read</span>
          </div>
        </div>
      </section>

      <div className="bp-wrap">
        <img className="bp-img" src={post.image} alt={post.imageAlt} width="1600" height="900" fetchpriority="high" />
        <article className="bp-col">
          {toc.length >= 4 && (
            <nav className="bp-toc" aria-label="In this article">
              <b>In this article</b>
              <ol>{toc.map((h) => <li key={h.id}><a href={`#${h.id}`}>{h.text.replace(/\*\*/g, "")}</a></li>)}</ol>
            </nav>
          )}
          <div className="bp-body">
            {content === null && [92, 100, 84, 96, 70].map((w, i) => <div key={i} className="bp-skel" style={{ width: `${w}%` }} />)}
            {content === false && <p>This article couldn't load. Check your connection and refresh the page.</p>}
            {blocks.map((b, i) => <Block key={i} b={b} />)}
          </div>

          {content && content.faq?.length > 0 && (
            <section style={{ marginTop: 40 }}>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: "var(--ink)", margin: "0 0 14px" }}>Questions people ask</h2>
              <Faq items={content.faq} openFirst={false} />
            </section>
          )}

          <div className="bp-share">
            <span>Share:</span>
            <a href={`https://wa.me/?text=${share}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
            <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer">Facebook</a>
            <a href={`https://x.com/intent/post?text=${share}`} target="_blank" rel="noopener noreferrer">X</a>
            <button type="button" onClick={copy}>Copy link</button>
          </div>

          {content && content.sources?.length > 0 && (
            <div className="bp-src">
              <h2>Sources</h2>
              <ol>{content.sources.map(([name, href]) => <li key={href}><a href={safeHref(href) || undefined} target="_blank" rel="noopener noreferrer">{name}</a></li>)}</ol>
            </div>
          )}
          <p className="bp-note">This article is general information to help you run your business, not legal, tax or financial advice for your own situation. Last updated {longDate(post.updated || post.date)}.</p>
        </article>
      </div>

      <section className="ks-sec">
        <div className="ks-wrap">
          <h2 className="ks-h2" style={{ fontSize: "clamp(24px,3vw,32px)", marginBottom: 22 }}>Keep reading</h2>
          <div className="bl-grid">{related.map((p) => <PostCard key={p.slug} p={p} />)}</div>
        </div>
      </section>

      <CtaBand title="Put this into practice today." text="KudiAI Track records your sales, shows your real profit and keeps your savings in order. Start free." />
    </SiteShell>
  );
}
