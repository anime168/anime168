// POST /functions/v1/create-video-upload
// body: { title: string }
//
// Admin-only. Creates a new "video" object inside your Bunny Stream
// library, then issues a short-lived, signed TUS upload ticket so the
// ADMIN'S BROWSER can upload the raw video file directly to Bunny
// (resumable, works for multi-GB files) WITHOUT ever exposing your
// Bunny API key to the client.
//
// Required secrets (supabase secrets set ...):
//   BUNNY_LIBRARY_ID   - the numeric "Video Library ID" from bunny.net
//   BUNNY_API_KEY      - the library's "Video Library API Key" (NOT the account API key)
//
// Frontend flow (see src/lib/uploadVideo.ts):
//   1. call this function -> { videoId, libraryId, signature, expire }
//   2. hand those to tus-js-client pointed at https://video.bunnycdn.com/tusupload
//   3. on success, store `videoId` (and the derived playback URLs) on the episode row
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireEnv, corsHeaders } from '../_shared/payway.ts';

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabaseUrl = requireEnv('SUPABASE_URL');
    const anonKey = requireEnv('SUPABASE_ANON_KEY');

    // Client scoped to the caller's own session - respects RLS.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    // Only admins may mint upload tickets. Requires an `is_admin` column
    // on `profiles` (see anime-app-schema.sql).
    const { data: profile, error: profileError } = await userClient
      .from('profiles')
      .select('is_admin')
      .eq('id', userData.user.id)
      .single();

    if (profileError || !profile?.is_admin) {
      return new Response(JSON.stringify({ error: 'Admin only' }), {
        status: 403,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const { title } = await req.json();
    if (!title || typeof title !== 'string') {
      return new Response(JSON.stringify({ error: 'title is required' }), {
        status: 400,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const libraryId = requireEnv('BUNNY_LIBRARY_ID');
    const apiKey = requireEnv('BUNNY_API_KEY');

    // 1. Create the video object in Bunny Stream to get a videoId.
    const createRes = await fetch(`https://video.bunnycdn.com/library/${libraryId}/videos`, {
      method: 'POST',
      headers: { AccessKey: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });

    if (!createRes.ok) {
      const detail = await createRes.text();
      return new Response(JSON.stringify({ error: 'Bunny create-video failed', detail }), {
        status: 502,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const created = await createRes.json();
    const videoId: string = created.guid;

    // 2. Sign a TUS upload ticket valid for 1 hour.
    // Bunny's formula: sha256(library_id + api_key + expiration + video_id)
    const expire = Math.floor(Date.now() / 1000) + 3600;
    const signature = await sha256Hex(`${libraryId}${apiKey}${expire}${videoId}`);

    return new Response(
      JSON.stringify({
        videoId,
        libraryId,
        signature,
        expire,
        endpoint: 'https://video.bunnycdn.com/tusupload',
      }),
      { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
});
