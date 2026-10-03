import { useEffect, useRef } from "react";

/**
 * A view opened over another (a sub-screen) as ONE browser-history entry, so the phone's back button (App.jsx: go back
 * while there is history, otherwise exit the app) and the browser's back close the view instead of leaving the app.
 * Returns `close()` for the on-screen back arrow — it leaves the same way, through the history, so the entry is gone.
 * @param active  whether the view is open
 * @param onBack  called when it is closed by a back press (set the view back)
 */
export function useHistoryStep(active, onBack) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    if (!active) return undefined;
    const marker = `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let closed = false;
    window.history.pushState({ ...(window.history.state || {}), ktOverlay: marker }, "");
    const onPop = () => {
      if (closed) return;
      closed = true;
      onBackRef.current?.();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // closed some other way (a link, the parent closing): take the entry back off the history
      if (!closed && window.history.state?.ktOverlay === marker) { closed = true; window.history.back(); }
    };
  }, [active]);
  return () => window.history.back();
}
