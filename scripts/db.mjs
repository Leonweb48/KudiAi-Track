/**
 * Reusable Supabase service-role client for admin scripts.
 * Usage: import { db } from './db.mjs'; then call db.from(...) or db.rpc(...)
 *
 * Service-role key bypasses RLS — reads/writes any row.
 * Never import this in browser code.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const env = {};
  try {
    const text = readFileSync(join(ROOT, '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch { /* .env optional */ }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.REACT_APP_SUPABASE_URL || 'https://eztohcuzbxxxvnondxfz.supabase.co';
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set in .env');
  process.exit(1);
}

export const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Thin wrapper: throw on Supabase errors instead of returning them. */
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}
