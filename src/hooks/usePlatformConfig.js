import { useEffect, useState } from "react";
import { supabase } from "../utils/supabase";

// Module-level cache: fetched once per browser session, reused across all hook calls.
let _cache = null;
let _pending = null;

function fetchConfig() {
  if (_pending) return _pending;
  _pending = supabase
    .from("platform_config")
    .select("key, value")
    .then(({ data }) => {
      const cfg = {};
      (data || []).forEach(r => { cfg[r.key] = r.value; });
      _cache = cfg;
      return cfg;
    })
    .catch(() => {
      _cache = {};
      return {};
    });
  return _pending;
}

export function usePlatformConfig() {
  const [config, setConfig] = useState(_cache);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    if (_cache) { setConfig(_cache); setLoading(false); return; }
    fetchConfig().then(cfg => { setConfig(cfg); setLoading(false); });
  }, []);

  return {
    coopEnabled: config?.coop_module_enabled === "true",
    configLoading: loading,
  };
}
