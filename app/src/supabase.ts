import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** A readable message from a Supabase or network error. */
export function errorText(e: unknown): string {
  if (!e) return 'Something went wrong. Try again.';
  const msg = typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'No connection. Check the internet and try again.';
  if (/row-level security|permission denied/i.test(msg)) return 'You don’t have permission to do that.';
  return msg;
}
