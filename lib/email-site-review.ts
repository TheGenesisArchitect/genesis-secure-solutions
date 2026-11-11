// "Your website is ready for review": the email a client gets when their site is up for their review (template
// site_review, scheduled from the client page's Client email panel, lib/client-email.ts). Built for action:
//  - their real site card (the site's own share image) linking to the site, with "hidden from Google until you approve"
//  - a short personal note from the person sending it
//  - "To finish your site": each open item from their welcome form, with a button straight to that field on their
//    dashboard's Welcome page (/app/<slug>/welcome?item=<key>#wl-<key>), plus anything to just answer by reply
//  - one main button to the dashboard, and what happens next
// Table layout and inline styles, so it reads the same in Gmail, Outlook and Apple Mail; a plain-text version too.

export type ReviewAsk = { label: string; help?: string; url?: string; cta?: string };
export type SiteReview = {
  first: string; agency: string; siteUrl: string; siteImage?: string; note: string; dashboardUrl: string;
  asks: ReviewAsk[]; replyAsks: string[]; done: number; total: number; next: string[]; address?: string; sender?: string;
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const INK = '#121419', SOFT = '#4a4f5a', MUTED = '#8b909a', LINE = '#ebe8e1', ORANGE = '#e8590c', CREAM = '#f6f4ef';
const F = 'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif';
const host = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');

const button = (label: string, url: string, big = false) =>
  `<a href="${esc(url)}" style="display:inline-block;background:${ORANGE};background-image:linear-gradient(90deg,#ff5a20,#ff9a1a);color:#ffffff;${F};font-weight:700;font-size:${big ? 16 : 13}px;line-height:1;text-decoration:none;padding:${big ? '16px 28px' : '10px 16px'};border-radius:999px;white-space:nowrap">${esc(label)}</a>`;

export function siteReviewEmail(r: SiteReview, origin: string): { subject: string; html: string; text: string; preheader: string } {
  const subject = `${r.first ? `${r.first}, your` : 'Your'} new website is ready for review`;
  const open = r.asks.length + r.replyAsks.length;
  const preheader = `See it at ${host(r.siteUrl)}. ${open ? `${open} quick thing${open === 1 ? '' : 's'} to finish it, right from your dashboard.` : 'Tell us what you think.'}`;
  const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
  const paras = r.note.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const askRow = (n: number, a: ReviewAsk) => `
<tr><td style="padding:14px 0;border-top:1px solid ${LINE}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="34" valign="top" style="padding-top:1px"><div style="width:24px;height:24px;border-radius:12px;background:#fff1e8;color:${ORANGE};${F};font-weight:700;font-size:12px;line-height:24px;text-align:center">${n}</div></td>
    <td valign="top" style="${F};padding-right:12px"><div style="font-size:15px;font-weight:600;color:${INK};line-height:1.35">${esc(a.label)}</div>${a.help ? `<div style="font-size:13px;color:${SOFT};line-height:1.45;padding-top:3px">${esc(a.help)}</div>` : ''}</td>
    <td width="1" valign="middle" align="right">${a.url ? button(a.cta || 'Add it', a.url) : `<span style="${F};font-size:12px;color:${MUTED}">Just reply</span>`}</td>
  </tr></table>
</td></tr>`;

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${CREAM}">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr><td align="center" style="padding:28px 12px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">

<tr><td style="background:${INK};border-radius:18px 18px 0 0;padding:18px 28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td><img src="${origin}/brand/genovus/genovus-mark-128.png" width="28" height="28" alt="Genovus" style="vertical-align:middle;border-radius:7px;border:0"><span style="${F};font-weight:800;font-size:13px;letter-spacing:3px;color:#ffffff;vertical-align:middle">&nbsp;&nbsp;GENOVUS</span></td>
    <td align="right" style="${F};font-size:12px;color:#b9bdc6;letter-spacing:.5px">${esc(r.agency)}</td>
  </tr></table>
</td></tr>

<tr><td style="background:#ffffff;padding:32px 28px 8px">
  <div style="${F};font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${ORANGE}">Your website is up</div>
  <h1 style="margin:8px 0 14px;${F};font-size:28px;line-height:1.2;font-weight:800;color:${INK}">${esc(r.first ? `${r.first}, your new site is ready for your review` : 'Your new site is ready for your review')}</h1>
  ${paras.map((p) => `<p style="margin:0 0 12px;${F};font-size:15px;line-height:1.6;color:${SOFT}">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
</td></tr>

<tr><td style="background:#ffffff;padding:10px 28px 6px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:14px;overflow:hidden">
    ${r.siteImage ? `<tr><td><a href="${esc(r.siteUrl)}"><img src="${esc(r.siteImage)}" width="542" alt="${esc(`${r.agency}: your new website`)}" style="display:block;width:100%;max-width:542px;height:auto;border:0"></a></td></tr>` : ''}
    <tr><td style="padding:16px 18px">
      <div style="${F};font-size:16px;font-weight:700;color:${INK};word-break:break-word">${esc(host(r.siteUrl))}</div>
      <div style="${F};font-size:12px;color:${MUTED};padding:3px 0 12px">Hidden from Google until you approve it</div>
      ${button('View your site', r.siteUrl)}
    </td></tr>
  </table>
</td></tr>

${open ? `<tr><td style="background:#ffffff;padding:26px 28px 4px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="${F};font-size:18px;font-weight:800;color:${INK}">To finish your site</td>
    <td align="right" style="${F};font-size:12px;color:${MUTED}">${r.done} of ${r.total} done</td>
  </tr></table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 4px"><tr>
    <td style="background:${ORANGE};height:6px;border-radius:3px 0 0 3px;font-size:0;line-height:0" width="${Math.max(pct, 2)}%">&nbsp;</td>
    <td style="background:${LINE};height:6px;border-radius:0 3px 3px 0;font-size:0;line-height:0">&nbsp;</td>
  </tr></table>
  <p style="margin:8px 0 6px;${F};font-size:13px;color:${SOFT};line-height:1.5">Each button opens that spot in your dashboard. It saves as you go, so do what you can now and come back any time.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${r.asks.map((a, i) => askRow(i + 1, a)).join('')}
    ${r.replyAsks.map((q, i) => askRow(r.asks.length + i + 1, { label: q })).join('')}
  </table>
</td></tr>` : ''}

<tr><td align="center" style="background:#ffffff;padding:22px 28px 30px;border-top:1px solid ${LINE}">
  ${button('Open your dashboard', r.dashboardUrl, true)}
  <div style="${F};font-size:12px;color:${MUTED};padding-top:10px">Sign in with this email address. No password; we send you a code.</div>
</td></tr>

${r.next.length ? `<tr><td style="background:#fbfaf7;padding:22px 28px 24px;border-top:1px solid ${LINE};border-radius:0 0 18px 18px">
  <div style="${F};font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${MUTED};padding-bottom:10px">What happens next</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${r.next.map((s, i) => `<tr><td width="26" valign="top" style="${F};font-size:13px;font-weight:700;color:${ORANGE};padding:4px 0">${i + 1}.</td><td style="${F};font-size:14px;line-height:1.5;color:${SOFT};padding:4px 0">${esc(s)}</td></tr>`).join('')}
  </table>
</td></tr>` : '<tr><td style="background:#ffffff;border-radius:0 0 18px 18px;height:8px;font-size:0">&nbsp;</td></tr>'}

<tr><td style="padding:20px 28px 0;${F};font-size:12px;line-height:1.6;color:${MUTED}" align="center">
  Questions? Reply to this email${r.sender ? ` and it reaches ${esc(r.sender)}` : ' to reach a person on our team'}, or ask Helix in your dashboard.<br>
  Genovus, a Genesis Secure Solutions brand${r.address ? ` · ${esc(r.address)}` : ''}
</td></tr>

</table></td></tr></table></body></html>`;

  const text = [
    r.first ? `${r.first}, your new site is ready for your review` : 'Your new site is ready for your review', '',
    ...paras.flatMap((p) => [p, '']),
    `See it: ${r.siteUrl} (hidden from Google until you approve it)`, '',
    ...(open ? [`TO FINISH YOUR SITE (${r.done} of ${r.total} done)`, ...r.asks.map((a, i) => `${i + 1}. ${a.label}${a.url ? `: ${a.url}` : ''}`), ...r.replyAsks.map((q, i) => `${r.asks.length + i + 1}. ${q} (reply to this email)`), ''] : []),
    `Open your dashboard: ${r.dashboardUrl}`, '',
    ...(r.next.length ? ['WHAT HAPPENS NEXT', ...r.next.map((s, i) => `${i + 1}. ${s}`), ''] : []),
    `Questions? Reply to this email or ask Helix in your dashboard.`,
    `Genovus, a Genesis Secure Solutions brand${r.address ? ` · ${r.address}` : ''}`,
  ].join('\n');
  return { subject, html, text, preheader };
}
