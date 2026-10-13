import { lazy } from "react";

// Loading app sections on demand (React.lazy) can fail when:
//  • the connection blips while the section downloads, or
//  • a new version was deployed and this page still runs the old one — its section files no longer exist.
// React remembers a failed import, so before this the screen stayed broken (often white) until the user refreshed or
// reopened the app (2026-10-14). Now: try again once; if it still fails and it looks like an old version, reload once
// to pick up the new one. The reload is limited to once a minute so a real outage can't loop.

const RELOAD_KEY = "kt_chunk_reload_at";

export function isChunkLoadError(err) {
  const m = String(err?.message || err || "");
  return err?.name === "ChunkLoadError"
    || /Loading (CSS )?chunk [\w-]+ failed|dynamically imported module|Importing a module script failed|error loading dynamically imported|Unexpected token '?<'?/i.test(m);
}

/** Reload the page to get the current version — at most once a minute. Returns true if it is reloading. */
export function reloadOnceForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 60000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { /* storage unavailable — still reload once */ }
  window.location.reload();
  return true;
}

/** Import a section, trying once more after a short pause; on a second failure that looks like an old version, reload once. */
export async function importWithRetry(factory, waitMs = 800) {
  try {
    return await factory();
  } catch (first) {
    await new Promise((r) => setTimeout(r, waitMs));
    try {
      return await factory();
    } catch (second) {
      if (isChunkLoadError(second) && reloadOnceForNewVersion()) return new Promise(() => {});   // page is reloading
      throw second;
    }
  }
}

export function lazyWithRetry(factory) {
  return lazy(() => importWithRetry(factory));
}
