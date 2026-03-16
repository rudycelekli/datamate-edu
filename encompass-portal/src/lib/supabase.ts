import { createClient } from "@supabase/supabase-js";

// Server-side admin client (service role key — full read/write)
// Lazy-initialized to avoid crashing when this module is bundled into the browser
let _adminClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseAdmin() {
  if (_adminClient) return _adminClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (server-only)");
  }
  _adminClient = createClient(url, key);
  return _adminClient;
}

// Keep backward-compatible export — lazy getter so it doesn't crash at import time
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createClient>, {
  get(_target, prop) {
    return (getSupabaseAdmin() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// Browser client (anon key — read-only via RLS)
let browserClient: ReturnType<typeof createClient> | null = null;

export function createBrowserClient() {
  if (browserClient) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn("Supabase browser client: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY not set");
    return null;
  }
  browserClient = createClient(url, key);
  return browserClient;
}
