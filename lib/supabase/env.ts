// Supabase settings from the Vercel integration. Older and newer integrations name the keys differently.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
export const supabaseConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
