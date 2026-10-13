import { useEffect, useState } from "react";

/**
 * The VISIBLE part of the screen — it shrinks when the on-screen keyboard opens (window.visualViewport). A full-screen
 * form sized to this keeps its inputs and its bottom buttons above the keyboard instead of underneath it.
 * Returns { h, top, keyboardOpen }.
 */
export function useVisibleViewport() {
  const read = () => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    return vv ? { h: vv.height, top: vv.offsetTop } : { h: typeof window !== "undefined" ? window.innerHeight : 0, top: 0 };
  };
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const vv = window.visualViewport;
    const on = () => setVp(read());
    vv?.addEventListener("resize", on);
    vv?.addEventListener("scroll", on);
    window.addEventListener("resize", on);
    return () => {
      vv?.removeEventListener("resize", on);
      vv?.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, []);
  const keyboardOpen = typeof window !== "undefined" && vp.h < window.innerHeight * 0.85;
  return { ...vp, keyboardOpen };
}

/** onFocus handler: once the keyboard has finished opening, bring the focused input to the middle of its scroll area. */
export function revealOnFocus(e) {
  const el = e.currentTarget;
  setTimeout(() => {
    try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch { /* old browsers */ }
  }, 320);
}
