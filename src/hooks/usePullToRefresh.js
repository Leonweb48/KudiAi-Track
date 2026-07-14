import { useEffect, useRef, useState } from "react";

const THRESHOLD = 56;  // damped px needed to trigger refresh
const MAX_Y     = 72;  // max damped pull distance

export function usePullToRefresh(onRefresh) {
  const scrollRef     = useRef(null);
  const startYRef     = useRef(null);
  const pulledRef     = useRef(0);
  const refreshingRef = useRef(false);
  const onRefreshRef  = useRef(onRefresh);
  const [pullY,      setPullY]      = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging,   setDragging]   = useState(false);

  // Always call latest onRefresh without restarting the effect
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function onTouchStart(e) {
      if (el.scrollTop > 2 || refreshingRef.current) return;
      startYRef.current = e.touches[0].clientY;
      pulledRef.current = 0;
      setDragging(true);
    }

    function onTouchMove(e) {
      if (startYRef.current === null) return;
      if (refreshingRef.current) return;
      if (el.scrollTop > 2) {
        startYRef.current = null;
        setDragging(false);
        setPullY(0);
        return;
      }
      const delta = e.touches[0].clientY - startYRef.current;
      if (delta <= 0) {
        if (pulledRef.current > 0) { pulledRef.current = 0; setPullY(0); }
        return;
      }
      e.preventDefault(); // stop scroll so we drive the pull indicator instead
      const damped = Math.min(Math.sqrt(delta * 3) * 4.5, MAX_Y);
      pulledRef.current = damped;
      setPullY(damped);
    }

    function onTouchEnd() {
      if (startYRef.current === null) return;
      startYRef.current = null;
      setDragging(false);
      const pulled = pulledRef.current;
      pulledRef.current = 0;
      if (pulled >= THRESHOLD * 0.75 && !refreshingRef.current) {
        refreshingRef.current = true;
        setPullY(THRESHOLD);
        setRefreshing(true);
        Promise.resolve(onRefreshRef.current()).finally(() => {
          refreshingRef.current = false;
          setRefreshing(false);
          setPullY(0);
        });
      } else {
        setPullY(0);
      }
    }

    el.addEventListener("touchstart",  onTouchStart, { passive: true  });
    el.addEventListener("touchmove",   onTouchMove,  { passive: false }); // non-passive to allow preventDefault
    el.addEventListener("touchend",    onTouchEnd,   { passive: true  });
    el.addEventListener("touchcancel", onTouchEnd,   { passive: true  });

    return () => {
      el.removeEventListener("touchstart",  onTouchStart);
      el.removeEventListener("touchmove",   onTouchMove);
      el.removeEventListener("touchend",    onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { scrollRef, pullY, refreshing, dragging };
}
