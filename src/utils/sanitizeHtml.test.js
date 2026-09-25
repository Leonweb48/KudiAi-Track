import { sanitizeHtml, safeExternalUrl } from "./sanitizeHtml";

describe("sanitizeHtml", () => {
  test("keeps the formatting stored legal / FAQ content really uses", () => {
    const html = '<h2>Terms</h2><p>Read <strong>this</strong> and <em>that</em>.</p><ul><li>one</li></ul><a href="https://kudiai.app/privacy">Privacy</a>';
    const out = sanitizeHtml(html);
    expect(out).toContain("<h2>Terms</h2>");
    expect(out).toContain("<strong>this</strong>");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain('href="https://kudiai.app/privacy"');
  });

  test("strips script tags, event handlers and javascript: links", () => {
    const out = sanitizeHtml('<p onclick="steal()">hi</p><script>alert(1)</script><img src=x onerror="steal()"><a href="javascript:steal()">x</a>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onclick|onerror/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain("hi");
  });

  test("removes forms, inputs, iframes and styles (phishing / clickjacking / restyling)", () => {
    const out = sanitizeHtml('<form action="https://evil.example"><input name="pin"></form><iframe src="https://evil.example"></iframe><style>body{display:none}</style><p>ok</p>');
    expect(out).not.toMatch(/<form|<input|<iframe|<style/i);
    expect(out).toContain("<p>ok</p>");
  });

  test("target=_blank links get rel=noopener noreferrer", () => {
    const out = sanitizeHtml('<a href="https://kudiai.app" target="_blank">go</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  test("null / undefined / non-strings never throw", () => {
    expect(sanitizeHtml(null)).toBe("");
    expect(sanitizeHtml(undefined)).toBe("");
    expect(sanitizeHtml(42)).toBe("42");
  });
});

describe("safeExternalUrl", () => {
  test("allows web, tel and mail links", () => {
    expect(safeExternalUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com/");
    expect(safeExternalUrl("tel:+2348012345678")).toBe("tel:+2348012345678");
    expect(safeExternalUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  test("rejects script-running and other schemes", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>1</script>", "vbscript:x", "file:///etc/passwd", "intent://x#Intent;end", "blob:https://x/y"]) {
      expect(safeExternalUrl(bad)).toBeNull();
    }
  });

  test("garbage input is null, not an exception", () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl("   ")).toBeNull();
  });
});
