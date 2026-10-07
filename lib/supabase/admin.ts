// The service-role client bypasses row-level security. Server only, and only for public intake and
// operator scripts; dashboards always read as the signed-in user (./server.ts).
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from './env';

const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function adminDb() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Supabase service key is not configured');
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
