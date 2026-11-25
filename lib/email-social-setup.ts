// "Let's finish connecting your profiles": the Social setup walkthrough email (template social_setup, scheduled like
// a client email, lib/client-email-core.ts scheduleSocial). Built from the agency's live Social setup status
// (lib/social-wizard.ts), so every agency gets the same thing:
//  - a short personal note
//  - each core channel (and any other one they started) with where it stands; open ones show the next step in a few
//    plain lines and a button straight to that channel on their Social setup page (/app/<slug>/social?c=<channel>)
//  - how posting works once they're connected (draft, their one-tap yes, Metricool publishes)
//  - one main button to Social setup
// Table layout and inline styles, so it reads the same in Gmail, Outlook and Apple Mail; a plain-text version too.

export type SocialRow = { name: string; state: 'done' | 'waiting' | 'next' | 'carrier'; next?: string; how?: string[]; url?: string };
export type SocialSetupEmail = {
  first: string; agency: string; note: string; socialUrl: string; done: number; total: number; rows: SocialRow[];
  posting: string[]; address?: string; sender?: string;
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const INK = '#121419', SOFT = '#4a4f5a', MUTED = '#8b909a', LINE = '#ebe8e1', ORANGE = '#e8590c', CREAM = '#f6f4ef', GREEN = '#1f8a4c';
const F = 'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif';

const button = (label: string, url: string, big = false) =>
  `<a href="${esc(url)}" style="display:inline-block;background:${ORANGE};background-image:linear-gradient(90deg,#ff5a20,#ff9a1a);color:#ffffff;${F};font-weight:700;font-size:${big ? 16 : 13}px;line-height:1;text-decoration:none;padding:${big ? '16px 28px' : '10px 16px'};border-radius:999px;white-space:nowrap">${esc(label)}</a>`;

const PILL: Record<SocialRow['state'], [string, string, string]> = {
  done: ['Connected', '#e8f6ee', GREEN], waiting: ['Genovus is confirming', '#eef2f8', '#3b5b8c'],
  next: ['Your next step', '#fff1e8', ORANGE], carrier: ['Your carrier runs it', '#f1f0ec', SOFT],
};

export function socialSetupEmail(s: SocialSetupEmail, origin: string): { subject: string; html: string; text: string; preheader: string } {
  const open = s.rows.filter((r) => r.state === 'next');
  const subject = `${s.first ? `${s.first}, let’s` : 'Let’s'} finish connecting your profiles`;
  const preheader = open.length ? `${open.map((r) => r.name).join(' and ')}: a few short steps each, right from your dashboard.` : 'Everything is connected. Here is how posting works from here.';
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  const paras = s.note.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const row = (r: SocialRow) => {
    const [label, bg, fg] = PILL[r.state];
    return `
<tr><td style="padding:16px 0;border-top:1px solid ${LINE}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td valign="top" style="${F};padding-right:12px">
      <div style="font-size:16px;font-weight:700;color:${INK};line-height:1.3">${esc(r.name)}
        <span style="display:inline-block;margin-left:6px;padding:3px 9px;border-radius:999px;background:${bg};color:${fg};font-size:11px;font-weight:700;letter-spacing:.3px;vertical-align:2px">${esc(label)}</span></div>
      ${r.next ? `<div style="font-size:14px;font-weight:600;color:${INK};line-height:1.4;padding-top:8px">${esc(r.next)}</div>` : ''}
      ${r.how?.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:4px">${r.how.map((h, i) => `<tr><td width="20" valign="top" style="${F};font-size:13px;font-weight:700;color:${ORANGE};padding:3px 0">${i + 1}.</td><td style="${F};font-size:13px;line-height:1.5;color:${SOFT};padding:3px 0">${esc(h)}</td></tr>`).join('')}</table>` : ''}
    </td>
    <td width="1" valign="top" align="right" style="padding-top:2px">${r.url ? button('Open this step', r.url) : ''}</td>
  </tr></table>
</td></tr>`;
  };

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${CREAM}">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr><td align="center" style="padding:28px 12px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">

<tr><td style="background:${INK};border-radius:18px 18px 0 0;padding:18px 28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td><img src="${origin}/brand/genovus/genovus-mark-128.png" width="28" height="28" alt="Genovus" style="vertical-align:middle;border-radius:7px;border:0"><span style="${F};font-weight:800;font-size:13px;letter-spacing:3px;color:#ffffff;vertical-align:middle;padding-left:10px">GENOVUS</span></td>
    <td align="right" style="${F};font-size:12px;color:#b9bdc6;letter-spacing:.5px">${esc(s.agency)}</td>
  </tr></table>
</td></tr>

<tr><td style="background:#ffffff;padding:32px 28px 8px">
  <div style="${F};font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${ORANGE}">Social setup</div>
  <h1 style="margin:8px 0 14px;${F};font-size:28px;line-height:1.2;font-weight:800;color:${INK}">${esc(s.first ? `${s.first}, let’s finish connecting your profiles` : 'Let’s finish connecting your profiles')}</h1>
  ${paras.map((p) => `<p style="margin:0 0 12px;${F};font-size:15px;line-height:1.6;color:${SOFT}">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
</td></tr>

<tr><td style="background:#ffffff;padding:18px 28px 4px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="${F};font-size:18px;font-weight:800;color:${INK}">Where each profile stands</td>
    <td align="right" style="${F};font-size:12px;color:${MUTED}">${s.done} of ${s.total} connected</td>
  </tr></table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 4px"><tr>
    <td style="background:${ORANGE};height:6px;border-radius:3px 0 0 3px;font-size:0;line-height:0" width="${Math.max(pct, 2)}%">&nbsp;</td>
    <td style="background:${LINE};height:6px;border-radius:0 3px 3px 0;font-size:0;line-height:0">&nbsp;</td>
  </tr></table>
  <p style="margin:8px 0 6px;${F};font-size:13px;color:${SOFT};line-height:1.5">Each button opens that step on your Social setup page. It saves as you go, and every step has “Do this with us on a call” if you’d rather we walk it together.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${s.rows.map(row).join('')}</table>
</td></tr>

<tr><td style="background:#ffffff;padding:18px 28px 6px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbfaf7;border:1px solid ${LINE};border-radius:14px"><tr><td style="padding:18px 20px">
    <div style="${F};font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${MUTED};padding-bottom:8px">How posting works once you’re connected</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${s.posting.map((p, i) => `<tr><td width="26" valign="top" style="${F};font-size:13px;font-weight:700;color:${ORANGE};padding:4px 0">${i + 1}.</td><td style="${F};font-size:14px;line-height:1.5;color:${SOFT};padding:4px 0">${esc(p)}</td></tr>`).join('')}
    </table>
  </td></tr></table>
</td></tr>

<tr><td align="center" style="background:#ffffff;padding:22px 28px 30px;border-radius:0 0 18px 18px">
  ${button('Open Social setup', s.socialUrl, true)}
  <div style="${F};font-size:12px;color:${MUTED};padding-top:10px">Sign in with this email address. No password; we send you a code.</div>
</td></tr>

<tr><td style="padding:20px 28px 0;${F};font-size:12px;line-height:1.6;color:${MUTED}" align="center">
  Questions? Reply to this email${s.sender ? ` and it reaches ${esc(s.sender)}` : ' to reach a person on our team'}, or ask Helix in your dashboard.<br>
  Genovus, a Genesis Secure Solutions brand${s.address ? ` · ${esc(s.address)}` : ''}
</td></tr>

</table></td></tr></table></body></html>`;

  const text = [
    s.first ? `${s.first}, let’s finish connecting your profiles` : 'Let’s finish connecting your profiles', '',
    ...paras.flatMap((p) => [p, '']),
    `WHERE EACH PROFILE STANDS (${s.done} of ${s.total} connected)`,
    ...s.rows.flatMap((r) => [`- ${r.name}: ${PILL[r.state][0]}${r.next ? `. Next: ${r.next}` : ''}`, ...(r.how ?? []).map((h, i) => `    ${i + 1}. ${h}`), ...(r.url ? [`    Open this step: ${r.url}`] : [])]), '',
    'HOW POSTING WORKS ONCE YOU’RE CONNECTED', ...s.posting.map((p, i) => `${i + 1}. ${p}`), '',
    `Open Social setup: ${s.socialUrl}`, '',
    `Questions? Reply to this email${s.sender ? ` and it reaches ${s.sender}` : ''}, or ask Helix in your dashboard.`,
  ].join('\n');
  return { subject, html, text, preheader };
}
