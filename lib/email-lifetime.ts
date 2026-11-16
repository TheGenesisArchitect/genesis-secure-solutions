// "Growth is yours for life": the founding-client thank-you email (template lifetime_growth), scheduled through the
// ops endpoint or the client page like every client email (lib/client-email-core.ts). Same Genovus frame as the
// site-review email (lib/email-site-review.ts): a short personal note, the locked rate and what it saves, what the
// program does for the agency, one button to the dashboard (where the congratulations card waits), and our thanks.
// Table layout and inline styles for Gmail, Outlook and Apple Mail; a plain-text version too.

export type LifetimeEmail = {
  first: string; agency: string; program: string; careName: string; note: string; dashboardUrl: string;
  rate: string; list: string; savedMonth: string; savedYear: string; waived?: string;
  adds: { label: string; blurb: string }[]; sender?: string; address?: string;
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const INK = '#121419', SOFT = '#4a4f5a', MUTED = '#8b909a', LINE = '#ebe8e1', ORANGE = '#e8590c', CREAM = '#f6f4ef';
const F = 'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif';

const button = (label: string, url: string) =>
  `<a href="${esc(url)}" style="display:inline-block;background:${ORANGE};background-image:linear-gradient(90deg,#ff5a20,#ff9a1a);color:#ffffff;${F};font-weight:700;font-size:16px;line-height:1;text-decoration:none;padding:16px 28px;border-radius:999px;white-space:nowrap">${esc(label)}</a>`;

export function lifetimeEmail(r: LifetimeEmail, origin: string): { subject: string; html: string; text: string; preheader: string } {
  const subject = `${r.first ? `${r.first}, ` : ''}${r.program} is yours for life`;
  const preheader = `A thank-you for being our first client: every ${r.program} feature at ${r.rate}/mo, locked for life.`;
  const paras = r.note.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const stats = [
    { v: `${r.rate}/mo`, l: 'Locked for life' },
    { v: `${r.savedMonth}/mo`, l: `Saved vs ${r.careName} (${r.list})` },
    { v: r.savedYear, l: 'Saved every year' },
    ...(r.waived ? [{ v: r.waived, l: 'Upgrade fee waived' }] : []),
  ];
  const cell = (s: { v: string; l: string }) => `<td valign="top" width="${Math.floor(100 / stats.length)}%" style="padding:4px">
    <div style="background:#fff7f1;border:1px solid #ffd9c2;border-radius:12px;padding:14px 10px;text-align:center">
      <div style="${F};font-size:22px;font-weight:800;color:${ORANGE};line-height:1.1">${esc(s.v)}</div>
      <div style="${F};font-size:11px;color:${SOFT};line-height:1.35;padding-top:5px">${esc(s.l)}</div>
    </div></td>`;

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
<tr><td style="background:linear-gradient(90deg,#ff5a20,#ffa31a);background-color:${ORANGE};height:4px;font-size:0;line-height:0">&nbsp;</td></tr>

<tr><td style="background:#ffffff;padding:32px 28px 6px">
  <div style="${F};font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${ORANGE}">Founding client &middot; ${esc(r.program)} for life</div>
  <h1 style="margin:8px 0 16px;${F};font-size:28px;line-height:1.2;font-weight:800;color:${INK}">${esc(r.first ? `Congratulations, ${r.first}. ${r.program} is yours for life.` : `${r.program} is yours for life.`)}</h1>
  ${paras.map((p) => `<p style="margin:0 0 12px;${F};font-size:15px;line-height:1.6;color:${SOFT}">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
  <p style="margin:4px 0 12px;${F};font-size:15px;line-height:1.6;color:${INK};font-weight:600">With gratitude,<br>${esc(r.sender ? `${r.sender} and the Genovus team` : 'The Genovus team')}</p>
</td></tr>

<tr><td style="background:#ffffff;padding:8px 24px 6px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${stats.map(cell).join('')}</tr></table>
</td></tr>

<tr><td style="background:#ffffff;padding:22px 28px 6px">
  <div style="${F};font-size:18px;font-weight:800;color:${INK};padding-bottom:6px">What ${esc(r.program)} does for ${esc(r.agency)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${r.adds.map((m) => `<tr><td style="padding:9px 0;border-top:1px solid ${LINE}">
      <div style="${F};font-size:15px;font-weight:700;color:${INK}">${esc(m.label)}</div>
      <div style="${F};font-size:13px;color:${SOFT};line-height:1.45;padding-top:2px">${esc(m.blurb)}</div>
    </td></tr>`).join('')}
  </table>
</td></tr>

<tr><td align="center" style="background:#ffffff;padding:24px 28px 30px;border-top:1px solid ${LINE};border-radius:0 0 18px 18px">
  ${button('Open your dashboard', r.dashboardUrl)}
  <div style="${F};font-size:12px;color:${MUTED};padding-top:10px">Sign in with this email address. No password; we send you a code.</div>
</td></tr>

<tr><td style="padding:20px 28px 0;${F};font-size:12px;line-height:1.6;color:${MUTED}" align="center">
  Questions? Reply to this email${r.sender ? ` and it reaches ${esc(r.sender)}` : ' to reach a person on our team'}, or ask Helix in your dashboard.<br>
  Genovus, a Genesis Secure Solutions brand${r.address ? ` · ${esc(r.address)}` : ''}
</td></tr>

</table></td></tr></table></body></html>`;

  const text = [
    r.first ? `Congratulations, ${r.first}. ${r.program} is yours for life.` : `${r.program} is yours for life.`, '',
    ...paras.flatMap((p) => [p, '']),
    'With gratitude,', r.sender ? `${r.sender} and the Genovus team` : 'The Genovus team', '',
    ...stats.map((s) => `- ${s.v}: ${s.l}`), '',
    `WHAT ${r.program.toUpperCase()} DOES FOR ${r.agency.toUpperCase()}`,
    ...r.adds.map((m) => `- ${m.label}: ${m.blurb}`), '',
    `Open your dashboard: ${r.dashboardUrl}`, '',
    'Questions? Reply to this email or ask Helix in your dashboard.',
    `Genovus, a Genesis Secure Solutions brand${r.address ? ` · ${r.address}` : ''}`,
  ].join('\n');
  return { subject, html, text, preheader };
}
