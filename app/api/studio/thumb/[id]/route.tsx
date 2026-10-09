// The framed thumbnail: Nano Banana key art plus the Genovus signature frame (lib/studio-thumb.ts), rendered on
// demand as a PNG at 9:16 (Reels, Shorts, TikTok covers) or 1:1 (feed). Staff only (row-level security).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import { db } from '@/lib/supabase/server';
import { blobDataUrl } from '@/lib/studio-gen';
import { thumbElement, thumbSize } from '@/lib/studio-thumb';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

let cached: { display: Buffer; body: Buffer; mark: string } | null = null;
async function assets() {
  if (cached) return cached;
  const root = process.cwd();
  const [display, body, mark] = await Promise.all([
    readFile(path.join(root, 'lib/fonts/archivo-expanded-800.woff')),
    readFile(path.join(root, 'lib/fonts/inter-600.woff')),
    readFile(path.join(root, 'public/brand/genovus/genovus-egg.svg')),
  ]);
  cached = { display, body, mark: `data:image/svg+xml;base64,${mark.toString('base64')}` };
  return cached;
}

const TAG: Record<string, string> = { teaser: 'TEASER', proof: 'PROOF' };

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const supabase = await db();
  const { data: a } = await supabase.from('studio_art').select('blob_path, status, studio_episodes(title, kind, code, studio_series(name))').eq('id', id).maybeSingle();
  if (!a?.blob_path || a.status !== 'ready') return new Response('Not found', { status: 404 });
  const ep = a.studio_episodes as unknown as { title: string; kind: string; code: string; studio_series: { name: string } | null } | null;
  const art = await blobDataUrl(a.blob_path);
  if (!art) return new Response('Not found', { status: 404 });
  const { display, body, mark } = await assets();
  const q = new URL(req.url).searchParams;
  const square = q.get('size') === '1x1';
  const num = ep?.code.match(/-e(\d+)$/)?.[1];
  const tag = ep?.kind === 'episode' ? `EP ${num ?? 1}` : TAG[ep?.kind ?? ''] ?? 'GENOVUS';
  const title = ep?.title ?? 'Genovus';
  const img = new ImageResponse(thumbElement({ art, mark, title, tag, series: ep?.studio_series?.name ?? 'Genovus', square }), {
    ...thumbSize(square),
    fonts: [
      { name: 'Genovus Display', data: display, weight: 800, style: 'normal' },
      { name: 'Inter', data: body, weight: 600, style: 'normal' },
    ],
  });
  const headers = new Headers(img.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (q.get('download') === '1') headers.set('Content-Disposition', `attachment; filename="${title.replace(/[^\w]+/g, '-').toLowerCase()}-${square ? '1x1' : '9x16'}.png"`);
  return new Response(img.body, { status: 200, headers });
}
