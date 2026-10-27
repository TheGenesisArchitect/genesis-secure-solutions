// Platform email through Resend, from hello@genovus.io. Templates are plain, branded and readable in any
// client (table layout, inline styles, a text version). Server only; nothing here is sent without a caller
// that has already checked permission (sign-in, invites) or a database event that queued it (outbox).
import 'server-only';
import { meetingIcs, meetingWhen } from './meeting-ics';

// The Vercel variable was created as RESEND_GENOVOUS_API_KEY; RESEND_API_KEY is accepted too.
const RESEND_KEY = () => process.env.RESEND_API_KEY || process.env.RESEND_GENOVOUS_API_KEY || '';
export const emailConfigured = () => Boolean(RESEND_KEY());
const FROM = () => process.env.EMAIL_FROM || 'Genovus <hello@genovus.io>';
const REPLY_TO = () => process.env.EMAIL_REPLY_TO || 'hello@genovus.io';

export type Attachment = { filename: string; content: string; contentType: string };
export type Mail = { to: string; subject: string; html: string; text: string; attachments?: Attachment[]; replyTo?: string };

export async function sendEmail(m: Mail): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!emailConfigured()) return { ok: false, error: 'email not configured' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM(), to: [m.to], reply_to: m.replyTo || REPLY_TO(), subject: m.subject, html: m.html, text: m.text,
        ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64'), content_type: a.contentType })) } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (res.ok && body.id) return { ok: true, id: body.id };
    console.error(`[email] Resend refused "${m.subject}": ${res.status} ${body.message ?? ''}`);
    return { ok: false, error: body.message ?? `HTTP ${res.status}` };
  } catch (e) {
    console.error(`[email] send failed: ${e instanceof Error ? e.message : e}`);
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One branded frame for every email: mark, heading, body, an optional button and code, and a quiet footer. */
function frame(o: { preheader: string; heading: string; body: string[]; button?: { label: string; url: string }; code?: string; foot?: string }, origin: string) {
  const btn = o.button
    ? `<tr><td style="padding:8px 0 4px"><a href="${esc(o.button.url)}" style="display:inline-block;background:#ff6a2b;background-image:linear-gradient(90deg,#ff5a20,#ffa31a);color:#160803;font:700 15px/1 Arial,sans-serif;text-decoration:none;padding:14px 22px;border-radius:999px">${esc(o.button.label)}</a></td></tr>`
    : '';
  const code = o.code
    ? `<tr><td style="padding:18px 0 4px;font:14px/1.5 Arial,sans-serif;color:#5b6170">Or enter this code on the sign-in page:</td></tr>
       <tr><td style="padding:4px 0 8px"><span style="display:inline-block;font:700 28px/1 'Courier New',monospace;letter-spacing:6px;color:#121419;background:#f2f2ee;border-radius:10px;padding:12px 16px">${esc(o.code)}</span></td></tr>`
    : '';
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;background:#f6f6f4"><span style="display:none;max-height:0;overflow:hidden">${esc(o.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f4;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:28px">
<tr><td style="padding-bottom:18px"><img src="${origin}/brand/genovus/genovus-mark-128.png" width="32" height="32" alt="" style="vertical-align:middle;border-radius:8px"> <span style="font:800 14px Arial,sans-serif;letter-spacing:3px;color:#121419;vertical-align:middle">&nbsp;GENOVUS</span></td></tr>
<tr><td style="font:800 22px/1.25 Arial,sans-serif;color:#121419;padding-bottom:10px">${esc(o.heading)}</td></tr>
${o.body.map((p) => `<tr><td style="font:15px/1.55 Arial,sans-serif;color:#3a3e47;padding-bottom:10px">${esc(p)}</td></tr>`).join('')}
${btn}${code}
<tr><td style="font:12px/1.5 Arial,sans-serif;color:#8b909a;padding-top:20px;border-top:1px solid #eee">${esc(o.foot ?? 'Genovus, a Genesis Secure Solutions brand. Reply to this email to reach a person on our team.')}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [o.heading, '', ...o.body, ...(o.button ? ['', `${o.button.label}: ${o.button.url}`] : []), ...(o.code ? ['', `Code: ${o.code}`] : []), '', o.foot ?? 'Genovus, a Genesis Secure Solutions brand.'].join('\n');
  return { html, text };
}

export function signInEmail(to: string, link: string, code: string, origin: string): Mail {
  return {
    to,
    subject: `Your Genovus sign-in code: ${code}`,
    ...frame({
      preheader: `Code ${code}. It works once and expires in an hour.`,
      heading: 'Sign in to Genovus',
      body: ['Tap the button to continue, or type the code on the sign-in page. Both work once and expire in an hour.', 'If you did not ask to sign in, you can ignore this email.'],
      button: { label: 'Continue to Genovus', url: link },
      code,
    }, origin),
  };
}

export function inviteEmail(to: string, agency: string, inviter: string, link: string, code: string, origin: string): Mail {
  return {
    to,
    subject: `${inviter} invited you to ${agency} on Genovus`,
    ...frame({
      preheader: `Your ${agency} dashboard is ready.`,
      heading: `Your ${agency} dashboard is ready`,
      body: [`${inviter} invited you to the ${agency} dashboard on Genovus: your setup, approvals, monthly care and results in one place.`, 'No password to create. Tap the button, and you will stay signed in on this device.'],
      button: { label: 'Open my dashboard', url: link },
      code,
    }, origin),
  };
}

export function outboxEmail(template: string, to: string, data: Record<string, string>, origin: string): Mail | null {
  switch (template) {
    case 'lead_new': {
      // A new lead: who, how to reach them, what they want and where they found the agency. Call within minutes.
      const how = data.channel === 'call' ? 'called the office' : data.channel === 'partner' ? 'came from a referral partner' : 'asked for a callback';
      const team = data.team === 'true';
      return {
        to,
        subject: `New lead for ${data.agency}: ${data.name}${data.topic ? ` (${data.topic})` : ''}`,
        ...frame({
          preheader: `${data.name} ${how}${data.phone ? `: ${data.phone}` : ''}. The sooner you call, the likelier they book.`,
          heading: `${data.name} ${how}`,
          body: [
            ...(team ? [`${data.agency} has no owner signed in yet, so this alert came to the Genovus team. Pass it on.`] : []),
            [data.phone && `Phone: ${data.phone}`, data.email && `Email: ${data.email}`].filter(Boolean).join(' · '),
            ...(data.topic ? [`About: ${data.topic}`] : []),
            ...(data.message ? [`“${data.message}”`] : []),
            `Found you through: ${data.source}.`,
            'The sooner you call, the likelier they are to book. It is waiting in your Leads with its consent on record.',
          ],
          button: { label: 'Open the lead', url: `${origin}/app/${data.slug}/leads` },
        }, origin),
      };
    }
    case 'meeting_invite': {
      // A meeting invite (or its cancellation) from the Genovus team, with the event attached for one-tap Yes / No.
      const cancelled = data.status === 'cancelled';
      const m = { id: data.event, title: data.title, starts: data.starts, ends: data.ends, location: data.location ?? '', notes: data.notes ?? '', attendees: (data.attendees ?? '').split(',').filter(Boolean), sequence: Number(data.sequence ?? 0), cancelled };
      const when = meetingWhen(m.starts, m.ends);
      // Replies and RSVPs go to the Genovus person who sent it (the team inbox if that is unknown).
      const sender = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(data.from_email ?? '') ? data.from_email : REPLY_TO();
      return {
        to,
        replyTo: sender,
        subject: `${cancelled ? 'Cancelled' : Number(m.sequence) > 0 ? 'Updated invitation' : 'Invitation'}: ${m.title} · ${when}`,
        ...frame({
          preheader: cancelled ? `${m.title} on ${when} is cancelled.` : `${when}${m.location ? ` · ${m.location}` : ''}`,
          heading: cancelled ? `Cancelled: ${m.title}` : m.title,
          body: cancelled
            ? [`${when}.`, 'This meeting is cancelled; it comes off your calendar when you open the attached update. Reply to this email if you’d like a new time.']
            : [`When: ${when}`, ...(m.location ? [`Where: ${m.location}`] : []), ...(m.notes ? [m.notes] : []), `It’s on the ${data.agency} calendar in Genovus too. Open the attached invite to add it to your own calendar, or reply to this email with any questions.`],
          button: cancelled ? undefined : { label: 'Open your calendar', url: `${origin}/app/${data.slug}/calendar` },
        }, origin),
        attachments: [{ filename: 'invite.ics', content: meetingIcs(m, sender, data.from_name || 'Genovus'), contentType: `text/calendar; charset=utf-8; method=${cancelled ? 'CANCEL' : 'REQUEST'}` }],
      };
    }
    case 'checklist_ready':
      return {
        to,
        subject: `Thank you, ${data.first}: your setup checklist for ${data.agency}`,
        ...frame({
          preheader: 'About ten minutes, and we start building your site.',
          heading: 'Your deposit is in. Let’s build your site.',
          body: ['Thank you! Here is your setup checklist: your headshot, office hours, licensed states and a few links. It takes about ten minutes.', 'Everything you enter goes straight onto your site and dashboard. You can come back to this link any time to change it.'],
          button: { label: 'Open my checklist', url: data.link },
          foot: 'Questions? Just reply to this email.',
        }, origin),
      };
    case 'proposal_ready':
      return {
        to,
        subject: `Your Genovus proposal: ${data.package} for ${data.agency}`,
        ...frame({
          preheader: 'Your package, the price, and what happens next, on one page.',
          heading: `Hi ${data.first}, your proposal is ready`,
          body: [`Here is the ${data.package} package for ${data.agency}: what we build, the price, and each step from today to your site going live.`, 'When you’re ready, pay the 70% deposit from the proposal and we start right away. The balance is due at launch.'],
          button: { label: 'Open my proposal', url: data.link },
          foot: 'Questions? Just reply to this email.',
        }, origin),
      };
    case 'approval_waiting':
      return {
        to,
        subject: `Approval needed: ${data.title}`,
        ...frame({
          preheader: 'Nothing goes out in your name until you approve it.',
          // A batch (a month of posts) arrives as one email with its count.
          heading: data.count ? `${data.count} posts are ready for your approval` : 'Something is ready for your approval',
          body: data.count
            ? [`${data.title}, for ${data.agency}. Each one shows the ad, the caption and when it goes out.`, 'Nothing is posted in your name until you approve it. Approve each post, or tell us what to change.']
            : [`${data.title}, for ${data.agency}.`, 'Nothing is posted, published or charged in your name until you approve it. Approve, or tell us what to change.'],
          button: { label: data.count ? 'Review them' : 'Review it', url: `${origin}/app/${data.slug}/approvals` },
        }, origin),
      };
    case 'invoice_ready':
      return {
        to,
        subject: `Invoice ready: ${data.amount} for ${data.agency}`,
        ...frame({
          preheader: `Pay securely through Mercury${data.due ? `, due ${data.due}` : ''}.`,
          heading: `Your invoice for ${data.amount} is ready`,
          body: [`Your ${data.kind} invoice for ${data.agency} is ready${data.due ? ` and due ${data.due}` : ''}.`, 'Open Billing in your dashboard to pay securely through Mercury, our bank. Your receipt and payment history stay in your dashboard.'],
          button: { label: 'View and pay', url: `${origin}/app/${data.slug}/billing` },
        }, origin),
      };
    case 'upgrade_ready': {
      const plan = { growth: 'Growth', premium: 'Premium', launch: 'Launch' }[data.upgrade_to] ?? 'your new plan';
      const gets = data.upgrade_to === 'premium'
        ? 'up to eight pages and campaign pages, a CRM and lead pipeline, the AI concierge (approved answers only), ads management and priority response'
        : 'up to five pages, online intake and booking, a monthly content calendar, review requests and a monthly report with one recommended improvement';
      return {
        to,
        subject: `Your upgrade to ${plan}: ${data.amount}`,
        ...frame({
          preheader: `Everything you have paid counts toward ${plan}.`,
          heading: `Welcome to ${plan}, ${data.agency}`,
          body: [
            `Your upgrade adds ${gets}.`,
            `Everything you have already paid counts toward it, so you pay only the difference:`,
            ...(data.lines ? data.lines.split('\n') : []),
            `Total due: ${data.amount}${data.due ? ` by ${data.due}` : ''}.`,
            'What happens next: pay securely through Mercury from your Billing page. As soon as it clears, your plan switches to ' + plan + ' and your Genovus contact books a short kickoff to plan the new pages.',
          ],
          button: { label: 'Review and pay', url: `${origin}/app/${data.slug}/billing` },
        }, origin),
      };
    }
    case 'team_care_month':
      return {
        to,
        subject: `Care invoices drafted for ${data.month}`,
        ...frame({ preheader: `${data.count} to send`, heading: `${data.count} care invoice${data.count === '1' ? '' : 's'} ready for ${data.month}`, body: ['Each one needs its Mercury link, then Send. Clients see them in their Billing page and get an email.'], button: { label: 'Open the care desk', url: `${origin}/console/care` } }, origin),
      };
    case 'team_inquiry':
      return {
        to,
        subject: `New ${data.kind === 'carrier' ? 'carrier' : 'agency'} inquiry: ${data.org}`,
        ...frame({ preheader: `${data.name} at ${data.org}`, heading: `New inquiry from ${data.org}`, body: [`${data.name} asked to talk${data.kind === 'carrier' ? ' about a pilot' : ' about their agency'}. We promised a reply within one business day.`], button: { label: 'Open inquiries', url: `${origin}/console/inquiries` } }, origin),
      };
    case 'team_care':
      return {
        to,
        subject: `Care request from ${data.agency}: ${data.title}`,
        ...frame({ preheader: data.title, heading: `${data.agency} asked for help`, body: [`${data.title} (${data.kind}).`, 'Response time follows their plan.'], button: { label: 'Open the care desk', url: `${origin}/console/care` } }, origin),
      };
    case 'team_digest':
      return {
        to,
        subject: `Genovus today: ${data.summary}`,
        ...frame({ preheader: data.summary, heading: 'What needs the team today', body: data.lines.split('\n'), button: { label: 'Open the console', url: `${origin}/console` } }, origin),
      };
    default:
      return null;
  }
}
