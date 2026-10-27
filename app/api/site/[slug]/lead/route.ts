// A visitor's request from an agency site: a callback, or a consult time from the office's open times (Growth and
// Premium). Same site only; the site decides the agency (never the visitor); bots fall to a hidden field and a
// minimum fill time; the visitor's consent is the exact sentence they ticked. Lands in the agency's Leads, which
// alerts the office.
import { siteFor } from '@/lib/site-access';
import { adminDb } from '@/lib/supabase/admin';
import { openTimes } from '@/lib/helix-lookups';
import { easternIso } from '@/lib/agency-calendar';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  if (origin && origin !== url.origin) return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  const { slug } = await ctx.params;
  const site = await siteFor(slug, url.searchParams.get('k'));
  if (!site) return Response.json({ ok: false, error: 'This site isn’t available.' }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string, n: number) => String(b[k] ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, n);
  // Bots: the hidden field, or a form filled faster than a person can.
  if (str('website', 200) || Number(b.ms) < 2500) return Response.json({ ok: true, message: 'Thanks! The office will be in touch.' });
  const name = str('name', 120), phone = str('phone', 40), email = str('email', 200).toLowerCase();
  if (name.length < 2) return Response.json({ ok: false, error: 'Please add your name.' }, { status: 400 });
  if (!phone && !email) return Response.json({ ok: false, error: 'Please add a phone number or an email so the office can reach you.' }, { status: 400 });
  if (phone && phone.replace(/\D/g, '').length < 10) return Response.json({ ok: false, error: 'Please check the phone number.' }, { status: 400 });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ ok: false, error: 'Please check the email.' }, { status: 400 });
  if (b.consent !== true) return Response.json({ ok: false, error: 'Please tick the box so the office may contact you.' }, { status: 400 });
  const d = site.d, db = adminDb();
  // A few requests an hour from the same phone or email is plenty.
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('tenant_id', d.tenantId).gte('created_at', since).or([phone ? `phone.eq.${phone}` : '', email ? `email.eq.${email}` : ''].filter(Boolean).join(','));
  if ((count ?? 0) >= 3) return Response.json({ ok: true, message: 'Thanks! The office already has your request and will be in touch.' });
  // A consult time must be one the office actually has open right now.
  let requested: string | null = null;
  const slot = str('slot', 40);
  if (slot && d.booking) {
    const open = await openTimes(db, d.tenantId, { minutes: 30, days: 10 });
    const hit = open.slots.find((x: { day: string; time: string }) => easternIso(x.day, x.time) === slot);
    if (!hit) return Response.json({ ok: false, error: 'That time was just taken. Please pick another.' }, { status: 409 });
    requested = slot;
  }
  const consent = `I agree that ${d.agency} may contact me about this request.`;
  const topic = str('topic', 120);
  // The requested time leads the message, so the office's new-lead alert shows it.
  const asked = requested ? `Asked for a consult on ${new Date(requested).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} (Eastern). Confirm it in Leads.` : '';
  const message = [asked, str('message', 1000)].filter(Boolean).join('\n\n');
  const { error } = await db.rpc('site_lead', {
    p_tenant: d.tenantId, p_ext_id: `site:${crypto.randomUUID()}`, p_name: name, p_email: email || null, p_phone: phone || null, p_topic: topic || null,
    p_message: message || null, p_source: d.live ? 'website' : 'website-preview', p_medium: requested ? 'booking' : 'callback', p_campaign: null,
    p_attribution: { page: req.headers.get('referer') ?? null }, p_consent: consent, p_requested_for: requested,
  });
  if (error) return Response.json({ ok: false, error: 'We couldn’t send that. Please call the office instead.' }, { status: 500 });
  const when = requested ? new Date(requested).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : null;
  return Response.json({ ok: true, message: when ? `You asked for ${when} (Eastern). The office will confirm shortly.` : `The office will call you back soon${d.firstName ? `: ${d.firstName} or someone on the team` : ''}.` });
}

