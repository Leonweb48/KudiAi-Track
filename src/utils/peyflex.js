import { supabase } from "./supabase";

export async function peyflex(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("peyflex", {
    body: { action, payload },
  });
  if (error) throw new Error(error.message || "Peyflex request failed");
  return data;
}
