import { findClientByToken } from '@/lib/clients';
import { channelRegistry, channelsForClient, partnerDetailsFromEnv, type Channel } from '@/lib/channels';
import { SOCIAL_TEMPLATE } from '@/lib/templates';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** JSON inside a <script> block: escape anything that could close the tag. */
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

function stepsHtml(c: Channel): string {
  return c.steps
    .map((s, i) => {
      const how = s.how.map((h) => `<li>${esc(h)}</li>`).join('');
      const src = s.link ? `<a class="src" href="${esc(s.link.url)}" target="_blank" rel="noreferrer">${esc(s.link.label)}</a>` : '';
      return `<li class="step" data-step="${esc(s.id)}" data-n="${i + 1}"><div class="num">${i + 1}</div><h3>${esc(s.title)}</h3>${
        s.why ? `<p class="why">${esc(s.why)}</p>` : ''
      }<div class="how"><ol>${how}</ol>${src}</div><div class="actions"></div></li>`;
    })
    .join('');
}

function linkFieldHtml(c: Channel): string {
  if (!c.profileLink) return '';
  const id = esc(c.id);
  return `<div class="linkfield field"><label for="link-${id}">${esc(c.profileLink.label)}, once it exists. We add it to your website.</label><input type="url" inputmode="url" id="link-${id}" data-link="${id}" data-name="${esc(
    c.name,
  )}" maxlength="200" placeholder="${esc(c.profileLink.placeholder)}" autocomplete="off"><p class="err" id="err-${id}" aria-live="polite"></p></div>`;
}

function sectionHtml(c: Channel): string {
  const head = `<header><h2>${esc(c.name)}</h2><p class="why">${esc(c.summary)}</p><p class="access">${esc(c.access)}</p></header>`;
  if (c.id === 'google') {
    const ask = `<div class="ask" role="radiogroup" aria-labelledby="g-q"><p class="q" id="g-q">Who looks after your Google listing today?</p><div class="choices">${[
      ['me', 'I do'],
      ['carrier', 'My carrier does'],
      ['none', 'There isn’t one yet'],
      ['unsure', 'Not sure'],
    ]
      .map(([v, l]) => `<label><input type="radio" name="googleOwner" value="${v}"> ${esc(l)}</label>`)
      .join('')}</div><p class="note" id="g-note"></p></div>`;
    return `<section class="channel" id="ch-google">${head}${ask}<div id="google-steps" hidden><ol class="steps">${stepsHtml(c)}</ol>${linkFieldHtml(c)}</div></section>`;
  }
  return `<section class="channel" id="ch-${esc(c.id)}">${head}<ol class="steps">${stepsHtml(c)}</ol>${linkFieldHtml(c)}</section>`;
}

function optionalHtml(c: Channel): string {
  return `<li class="opt" data-channel="${esc(c.id)}"><h3>${esc(c.name)}</h3><p>${esc(c.summary)}</p><p class="access">${esc(
    c.access,
  )}</p><button type="button" class="toggle" data-want="${esc(c.id)}" aria-pressed="false">I’d like this</button></li>`;
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const client = findClientByToken((await ctx.params).token);
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  if (!client) return new Response('<!doctype html><meta charset="utf-8"><title>Not found</title><p>This link is not valid.</p>', { status: 404, headers });

  const { plan, optional } = channelsForClient(channelRegistry(partnerDetailsFromEnv()), client.social?.plan ?? []);
  const config = {
    allSteps: plan.flatMap((c) => c.steps.map((s) => s.id)),
    googleSteps: plan.filter((c) => c.id === 'google').flatMap((c) => c.steps.map((s) => s.id)),
    hosts: Object.fromEntries(plan.filter((c) => c.profileLink).map((c) => [c.id, c.profileLink!.hosts])),
    optional: optional.map((c) => c.id),
  };
  const fill: Record<string, string> = {
    FIRST: esc(client.firstName),
    TOKEN: esc(client.token),
    SLUG: esc(client.slug),
    CONTACT: esc(client.contactName),
    PLAN_SECTIONS: plan.map(sectionHtml).join('\n  '),
    OPTIONAL_CARDS: optional.map(optionalHtml).join(''),
    CONFIG: safeJson(config),
  };
  const html = SOCIAL_TEMPLATE.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in fill ? fill[k] : m));
  return new Response(html, { headers });
}
