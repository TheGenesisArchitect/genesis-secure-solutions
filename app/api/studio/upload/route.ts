// Direct-to-storage uploads for the Studio (phone recordings for capture shots, final cuts, and Unedit vlogs). The browser
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
        // Creators' written permissions (Trend Remix licenses) are documents; everything else is video.
        const rights = /^studio\/rights\/[A-Za-z0-9._/-]+\.(pdf|png|jpe?g)$/i.test(pathname);
        const casting = /^studio\/casting\/[A-Za-z0-9._/-]+\.(png|jpe?g|webp)$/i.test(pathname);
        // Capture shots also take phone screenshots (StudioNext): a still of the real screen is a valid capture.
        const still = /^studio\/uploads\/[A-Za-z0-9._/-]+\.(png|jpe?g)$/i.test(pathname);
        // Unedit: a whole one-take vlog straight off the phone (multipart, up to 4 GB).
        const vlog = /^studio\/vlogs\/uploads\/[A-Za-z0-9._/-]+\.(mp4|mov|m4v|webm)$/i.test(pathname);
        if (!rights && !casting && !still && !vlog && !/^studio\/(uploads|finals)\/[A-Za-z0-9._/-]+\.(mp4|mov|webm)$/.test(pathname)) throw new Error('Upload an .mp4, .mov or .webm video, or a screenshot.');
        return {
          allowedContentTypes: rights ? ['application/pdf', 'image/png', 'image/jpeg'] : still ? ['image/png', 'image/jpeg'] : casting ? ['image/png', 'image/jpeg', 'image/webp'] : vlog ? ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm'] : ['video/mp4', 'video/quicktime', 'video/webm'],
          maximumSizeInBytes: (vlog ? 4096 : 300) * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Upload refused.' }, { status: 400 });
  }
}
