// Direct-to-storage uploads for the Studio (phone recordings for capture shots, and final cuts). The browser
// uploads straight into private Blob storage with a short-lived token issued here, only to the Genovus team and
// only into studio/uploads/ or studio/finals/. The file is registered afterwards by a server action.
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { db } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const supabase = await db();
        const { data: staff } = await supabase.rpc('is_staff');
        if (!staff) throw new Error('Only the Genovus team can upload to the Studio.');
        if (!/^studio\/(uploads|finals)\/[A-Za-z0-9._/-]+\.(mp4|mov|webm)$/.test(pathname)) throw new Error('Upload an .mp4, .mov or .webm video.');
        return {
          allowedContentTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
          maximumSizeInBytes: 300 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Upload refused.' }, { status: 400 });
  }
}
