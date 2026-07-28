/**
 * Uploads a raw video file straight from the admin's browser to Bunny
 * Stream using a resumable TUS upload — no Bunny credentials ever touch
 * the client, and multi-GB files survive flaky mobile connections
 * because failed chunks are simply retried/resumed.
 *
 * Requires: npm install tus-js-client
 *
 * Set in your .env (client-safe, public):
 *   VITE_BUNNY_PULL_ZONE=your-pull-zone.b-cdn.net
 */
import * as tus from 'tus-js-client';
import { supabase } from './supabaseClient';

export class VideoUploadError extends Error {}

export interface VideoUploadResult {
  videoId: string;
  videoUrl: string; // HLS playlist — put this straight into episodes.video_url
  thumbnailUrl: string;
}

interface UploadTicket {
  videoId: string;
  libraryId: string;
  signature: string;
  expire: number;
  endpoint: string;
}

const PULL_ZONE = import.meta.env.VITE_BUNNY_PULL_ZONE as string | undefined;

function buildUrls(videoId: string): { videoUrl: string; thumbnailUrl: string } {
  if (!PULL_ZONE) {
    throw new VideoUploadError('Missing VITE_BUNNY_PULL_ZONE in your .env file.');
  }
  return {
    videoUrl: `https://${PULL_ZONE}/${videoId}/playlist.m3u8`,
    thumbnailUrl: `https://${PULL_ZONE}/${videoId}/thumbnail.jpg`,
  };
}

/**
 * @param file       the raw video file selected by the admin (mp4, mov, mkv, ...)
 * @param title      a human-readable title shown in the Bunny dashboard (e.g. "Show Name - EP 12")
 * @param onProgress optional callback: (bytesUploaded, bytesTotal) => void
 */
export async function uploadVideo(
  file: File,
  title: string,
  onProgress?: (uploaded: number, total: number) => void
): Promise<VideoUploadResult> {
  // 1. Ask our Edge Function (admin-only) to open a video slot in Bunny
  //    and hand us a short-lived signed ticket to upload directly.
  const { data: ticket, error } = await supabase.functions.invoke<UploadTicket>(
    'create-video-upload',
    { body: { title } }
  );

  if (error || !ticket) {
    throw new VideoUploadError(error?.message || 'Could not start the upload.');
  }

  // 2. Stream the file straight to Bunny using the signed ticket.
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: ticket.endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        AuthorizationSignature: ticket.signature,
        AuthorizationExpire: String(ticket.expire),
        VideoId: ticket.videoId,
        LibraryId: ticket.libraryId,
      },
      metadata: {
        filetype: file.type,
        title,
      },
      onError: (err) => reject(new VideoUploadError(err.message)),
      onProgress: (uploaded, total) => onProgress?.(uploaded, total),
      onSuccess: () => resolve(),
    });
    upload.start();
  });

  const { videoUrl, thumbnailUrl } = buildUrls(ticket.videoId);
  return { videoId: ticket.videoId, videoUrl, thumbnailUrl };
}
