// Read a business's own website for Helix ("scan SPL Realty's site for anything that helps the pitch"). The URL never
// comes from the model or the person: the caller resolves it from the partner's Google listing. Only public http(s)
// on the standard ports; every hop (and every redirect, at most three) is checked against private, loopback and
// link-local addresses; 8 seconds and 1 MB per page, two pages at most (the home page and an About page). Returns
// plain text: whatever a website says is data for Helix to read, never instructions.
import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_BYTES = 1_000_000, TIMEOUT_MS = 8_000, MAX_REDIRECTS = 3, MAX_TEXT = 3500;
// Tests point at a local stand-in; never in production.
const allowLocal = () => process.env.SITE_SCAN_ALLOW_LOCAL === '1' && process.env.VERCEL_ENV !== 'production';

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('::ffff:') && privateAddress(v.slice(7));
}

/** Throws unless the URL is a public web address on a standard port. */
export async function assertPublic(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only web addresses can be read.');
  if (u.username || u.password) throw new Error('That address can’t be read.');
  if (u.port && !['80', '443'].includes(u.port) && !allowLocal()) throw new Error('That address can’t be read.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length) throw new Error('That website’s address didn’t resolve.');
  if (!allowLocal() && addrs.some((a) => privateAddress(a.address))) throw new Error('That address can’t be read.');
  return u;
}

async function fetchPage(start: string): Promise<{ url: string; html: string }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertPublic(url);
    const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'GenovusHelix/1.0 (+https://genovus.io)', Accept: 'text/html,text/plain' }, cache: 'no-store' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location')!, u).toString(); continue; }
    if (!res.ok) throw new Error(`The website answered ${res.status}.`);
    if (!/text\/(html|plain)/i.test(res.headers.get('content-type') ?? 'text/html')) throw new Error('That page isn’t a web page Helix can read.');
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); break; }
      chunks.push(value);
    }
    return { url: u.toString(), html: Buffer.concat(chunks).toString('utf8') };
  }
  throw new Error('Too many redirects.');
}

const decode = (s: string) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
/** The readable parts of a page: title, description, headings, then body text, scripts and styles removed. */
export function pageText(html: string): { title: string; description: string; text: string; about: string | null } {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const description = decode(html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1] ?? '').trim();
  const about = html.match(/<a[^>]+href=["']([^"'#]*about[^"'#]*)["']/i)?.[1] ?? null;
  const body = html.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|section|article|br|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ');
  const text = decode(body).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 2).join('\n');
  return { title, description, text, about };
}

export type SiteScan = { url: string; title: string; description: string; text: string };

/** The home page, plus its About page when there is one, as text (about 3,500 characters). */
export async function scanSite(website: string): Promise<SiteScan> {
  const home = await fetchPage(website);
  const h = pageText(home.html);
  let text = h.text;
  if (h.about && text.length < MAX_TEXT) {
    try {
      const a = await fetchPage(new URL(h.about, home.url).toString());
      text += `\n\nABOUT PAGE\n${pageText(a.html).text}`;
    } catch { /* the home page is enough */ }
  }
  return { url: home.url, title: h.title.slice(0, 200), description: h.description.slice(0, 400), text: text.slice(0, MAX_TEXT) };
}
