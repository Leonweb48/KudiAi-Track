import {
  mediaKindOf, youtubeId, youtubeThumb, prefersLiteMedia, canShowPopup, pickPopup,
  frameDurationMs, storyFrames, storyStep, STORY_IMAGE_MS,
} from "../utils/campaignRules";

describe("mediaKindOf — what a campaign's media is", () => {
  test.each([
    [{ url: "https://x.supabase.co/storage/v1/object/public/promotions/campaigns/a.jpg" }, "image"],
    [{ url: "https://cdn/x.webp?v=2" }, "image"],
    [{ url: "https://cdn/x.avif" }, "image"],
    [{ url: "https://cdn/x.GIF" }, "gif"],
    [{ url: "https://cdn/x.mp4" }, "video"],
    [{ url: "https://cdn/x.webm#t=1" }, "video"],
    [{ url: "https://cdn/anim.json" }, "lottie"],
    [{ url: "https://youtu.be/dQw4w9WgXcQ" }, "youtube"],
    [{ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10" }, "youtube"],
    [{ url: "https://youtube.com/shorts/dQw4w9WgXcQ" }, "youtube"],
    [{ url: "https://cdn/x.jpg", media_type: "video" }, "video"],      // the admin's explicit type wins
    [{ url: "https://cdn/x.mp4", media_type: "nonsense" }, "video"],   // invalid type → worked out from the link
    [{ url: "" }, ""],
  ])("%j → %s", (input, want) => expect(mediaKindOf(input)).toBe(want));
});

describe("YouTube helpers", () => {
  test("id from every link shape", () => {
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://example.com/watch?v=dQw4w9WgXcQ")).toBe("");
  });
  test("thumbnail", () => expect(youtubeThumb("abc12345678")).toBe("https://i.ytimg.com/vi/abc12345678/hqdefault.jpg"));
});

describe("prefersLiteMedia — data saver / 2G / reduce motion", () => {
  const win = (reduce) => ({ matchMedia: () => ({ matches: reduce }) });
  test("data saver", () => expect(prefersLiteMedia({ connection: { saveData: true } }, win(false))).toBe(true));
  test("2G", () => expect(prefersLiteMedia({ connection: { effectiveType: "2g" } }, win(false))).toBe(true));
  test("slow-2G", () => expect(prefersLiteMedia({ connection: { effectiveType: "slow-2g" } }, win(false))).toBe(true));
  test("reduce motion", () => expect(prefersLiteMedia({}, win(true))).toBe(true));
  test("4G, no preference → full media", () => expect(prefersLiteMedia({ connection: { effectiveType: "4g" } }, win(false))).toBe(false));
});

describe("canShowPopup — the admin's frequency cap, at most one pop-up per app session", () => {
  const day = (iso) => Date.parse(iso);
  test("never shown → yes", () => expect(canShowPopup({ cap: "once_ever", lastShownAt: null })).toBe(true));
  test("any pop-up already this session → no, whatever the cap", () => {
    expect(canShowPopup({ cap: "always", lastShownAt: null, shownThisSession: true })).toBe(false);
  });
  test("once_ever: shown before → never again", () => {
    expect(canShowPopup({ cap: "once_ever", lastShownAt: day("2026-01-01T10:00:00Z"), now: day("2026-10-02T10:00:00Z") })).toBe(false);
  });
  test("once_per_day: same Nigerian day → no; next day → yes", () => {
    // 22:30 UTC on 1 Oct is 23:30 in Lagos; 23:30 UTC is already 00:30 on 2 Oct in Lagos
    expect(canShowPopup({ cap: "once_per_day", lastShownAt: day("2026-10-01T08:00:00Z"), now: day("2026-10-01T22:30:00Z") })).toBe(false);
    expect(canShowPopup({ cap: "once_per_day", lastShownAt: day("2026-10-01T08:00:00Z"), now: day("2026-10-01T23:30:00Z") })).toBe(true);
  });
  test("always = every visit (a new session)", () => {
    expect(canShowPopup({ cap: "always", lastShownAt: day("2026-10-02T09:00:00Z"), now: day("2026-10-02T09:05:00Z") })).toBe(true);
  });
  test("pickPopup takes the first one allowed, in priority order", () => {
    const store = { shownThisSession: () => false, lastShown: (id) => (id === "a" ? Date.now() - 1000 : null) };
    expect(pickPopup([{ id: "a", frequency_cap: "once_ever" }, { id: "b", frequency_cap: "once_ever" }], store)?.id).toBe("b");
    expect(pickPopup([{ id: "a", frequency_cap: "once_ever" }], store)).toBeNull();
    expect(pickPopup([{ id: "b" }], { ...store, shownThisSession: () => true })).toBeNull();
  });
});

describe("stories", () => {
  const S = (id, n) => ({ id, stories: Array.from({ length: n }, (_, i) => ({ url: `https://cdn/${id}${i}.jpg` })) });
  test("frame length: picture 5 s, admin override clamped, video/animation/YouTube decided by the media", () => {
    expect(frameDurationMs({ url: "a.jpg" })).toBe(STORY_IMAGE_MS);
    expect(frameDurationMs({ url: "a.jpg", duration_ms: 8000 })).toBe(8000);
    expect(frameDurationMs({ url: "a.jpg", duration_ms: 500 })).toBe(2000);
    expect(frameDurationMs({ url: "a.jpg", duration_ms: 999999 })).toBe(60000);
    expect(frameDurationMs({ url: "a.mp4" })).toBeNull();
    expect(frameDurationMs({ url: "a.json" })).toBeNull();
    expect(frameDurationMs({ url: "https://youtu.be/dQw4w9WgXcQ" })).toBeNull();
  });
  test("frames without media are dropped; at most 10", () => {
    expect(storyFrames({ stories: [{ url: "" }, { url: "a.jpg" }, null, "x"] })).toEqual([{ url: "a.jpg" }]);
    expect(storyFrames(S("a", 14))).toHaveLength(10);
    expect(storyFrames({})).toEqual([]);
  });
  test("next / previous across frames and stories; the end closes", () => {
    const list = [S("a", 2), S("empty", 0), S("b", 1)];
    expect(storyStep({ s: 0, f: 0 }, "next", list)).toEqual({ s: 0, f: 1 });
    expect(storyStep({ s: 0, f: 1 }, "next", list)).toEqual({ s: 2, f: 0 });   // skips a story with no frames
    expect(storyStep({ s: 2, f: 0 }, "next", list)).toBeNull();
    expect(storyStep({ s: 2, f: 0 }, "prev", list)).toEqual({ s: 0, f: 0 });
    expect(storyStep({ s: 0, f: 1 }, "prev", list)).toEqual({ s: 0, f: 0 });
    expect(storyStep({ s: 0, f: 0 }, "prev", list)).toEqual({ s: 0, f: 0 });   // the very first frame stays
  });
});
