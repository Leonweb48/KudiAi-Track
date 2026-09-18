/**
 * Notification deep-link hand-off.
 *
 * Tapping a notification navigates to a route, but the destination also has to
 * know WHICH record or sub-section to open. The tap handlers were passing that
 * as react-router `location.state` ({ id, sub }) — and nothing in the app ever
 * read it, so every tap landed on the right tab and stopped there.
 *
 * publishDeepLink() parks the link; a screen claims it with useDeepLink(),
 * either on mount (a lazy screen that loads AFTER the tap) or when it's
 * published (the screen is already open). A link is single-use and expires
 * after TTL_MS so a stale one can never fire when the user wanders to that
 * screen later on their own.
 */

import { useEffect, useRef } from "react";

const TTL_MS = 10000;

let pending = null;
const listeners = new Set();

export function publishDeepLink(dl) {
  if (!dl?.tab) return;
  pending = { ...dl, _t: Date.now() };
  listeners.forEach((fn) => fn());
}

function claim(tabs) {
  if (!pending) return null;
  if (Date.now() - pending._t > TTL_MS) { pending = null; return null; }
  if (!tabs.includes(pending.tab)) return null;
  const { _t, ...dl } = pending; // eslint-disable-line no-unused-vars
  pending = null;
  return dl;
}

/**
 * useDeepLink(["transactions"], (dl) => { ... })
 * `tabs` lists every deep_link.tab value this screen answers to.
 */
export function useDeepLink(tabs, handler) {
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; });

  const key = tabs.join(",");
  useEffect(() => {
    const list = key.split(",");
    const check = () => {
      const dl = claim(list);
      if (dl) handlerRef.current?.(dl);
    };
    check();
    listeners.add(check);
    return () => { listeners.delete(check); };
  }, [key]);
}
