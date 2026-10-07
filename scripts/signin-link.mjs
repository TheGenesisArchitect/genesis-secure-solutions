// Operator fallback while email is not connected: print a one-time "Continue" sign-in link for an invited
// person (staff, agency member or network partner). The link works once and expires in an hour.
//   node --env-file=<env file> scripts/signin-link.mjs someone@example.com [/app/slug] [https://site-origin]
import { createClient } from '@supabase/supabase-js';

const [email, next = '', origin = process.env.APP_ORIGIN || 'https://genesis-secure-solutions.vercel.app'] = process.argv.slice(2);
if (!email) throw new Error('usage: signin-link.mjs <email> [next] [origin]');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: id } = await admin.rpc('signin_user_id', { p_email: email });
if (!id) throw new Error(`${email} has no access yet: invite them first`);
const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
if (error) throw error;
console.log(`${origin}/auth/continue?t=${encodeURIComponent(data.properties.hashed_token)}${next ? `&next=${encodeURIComponent(next)}` : ''}`);
console.log(`code: ${data.properties.email_otp}  (works once, expires in an hour)`);
