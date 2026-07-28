// EXAMPLE ONLY — shows how to wire uploadVideo() into a simple admin form.
// Drop the relevant pieces into your real AccountScreen/Admin screen later.
import { useState } from 'react';
import { uploadVideo, VideoUploadError } from './lib/uploadVideo';
import { supabase } from './lib/supabaseClient';

export default function AdminUploadEpisode({ showId }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState(1);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('idle'); // idle | uploading | saving | done | error
  const [errorMsg, setErrorMsg] = useState('');

  async function handleUpload() {
    if (!file || !title) return;
    setStatus('uploading');
    setErrorMsg('');
    try {
      const result = await uploadVideo(file, title, (uploaded, total) => {
        setProgress(Math.round((uploaded / total) * 100));
      });

      setStatus('saving');
      const { error } = await supabase.from('episodes').insert({
        show_id: showId,
        episode_number: episodeNumber,
        title_en: title,
        video_url: result.videoUrl,
        thumbnail_url: result.thumbnailUrl,
      });
      if (error) throw error;

      setStatus('done');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof VideoUploadError ? err.message : String(err));
    }
  }

  return (
    <div className="p-4 space-y-3 max-w-sm">
      <input
        type="text"
        placeholder="Episode title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full border rounded px-3 py-2"
      />
      <input
        type="number"
        value={episodeNumber}
        onChange={(e) => setEpisodeNumber(Number(e.target.value))}
        className="w-full border rounded px-3 py-2"
      />
      <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />

      <button
        onClick={handleUpload}
        disabled={!file || !title || status === 'uploading' || status === 'saving'}
        className="w-full bg-green-500 text-white rounded px-3 py-2 font-bold disabled:opacity-50"
      >
        {status === 'uploading' ? `Uploading ${progress}%` : status === 'saving' ? 'Saving...' : 'Upload Episode'}
      </button>

      {status === 'done' && <p className="text-green-600 text-sm">Uploaded ✓</p>}
      {status === 'error' && <p className="text-red-600 text-sm">{errorMsg}</p>}
    </div>
  );
}
