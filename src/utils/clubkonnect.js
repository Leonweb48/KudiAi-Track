import { supabase } from "./supabase";

export async function clubkonnect(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("clubkonnect", {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message || "Bill service request failed");
  if (data?.error) throw new Error(data.error);
  return data;
}
