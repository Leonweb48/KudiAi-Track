import { useState, useEffect, useCallback } from "react";
import { supabase } from "../utils/supabase";

export function useBranches(userId) {
  const [branches, setBranches] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let active = true;
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("branches")
        .select("*")
        .eq("owner_id", userId)
        .order("created_at", { ascending: true });
      if (active && data) setBranches(data);
      if (active) setLoading(false);
    }
    load();
    return () => { active = false; };
  }, [userId]);

  const addBranch = useCallback(async (data) => {
    const { data: b, error } = await supabase.from("branches").insert({
      owner_id:   userId,
      name:       data.name.trim(),
      address:    data.address?.trim() || null,
      phone:      data.phone?.trim()   || null,
      manager_id: data.manager_id      || null,
    }).select().single();
    if (!error && b) setBranches(prev => [...prev, b]);
    return !error ? b : null;
  }, [userId]);

  const updateBranch = useCallback(async (id, data) => {
    const updates = {
      name:       data.name?.trim()   || "",
      address:    data.address?.trim() || null,
      phone:      data.phone?.trim()   || null,
      manager_id: data.manager_id      || null,
      is_active:  data.is_active ?? true,
    };
    const { error } = await supabase.from("branches").update(updates).eq("id", id);
    if (!error) setBranches(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
    return !error;
  }, []);

  const deleteBranch = useCallback(async (id) => {
    await supabase.from("branches").delete().eq("id", id);
    setBranches(prev => prev.filter(b => b.id !== id));
  }, []);

  return { branches, loading, addBranch, updateBranch, deleteBranch };
}
