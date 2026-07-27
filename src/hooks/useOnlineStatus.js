import { useState, useEffect, useRef } from "react";

export function useOnlineStatus() {
  const [online,        setOnline]        = useState(navigator.onLine);
  const [reconnectTick, setReconnectTick] = useState(0);
  const wasOffline = useRef(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      if (wasOffline.current) setReconnectTick(t => t + 1);
      wasOffline.current = false;
    };
    const handleOffline = () => {
      setOnline(false);
      wasOffline.current = true;
    };
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return { online, reconnectTick };
}
