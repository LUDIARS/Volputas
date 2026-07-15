import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadVideoReview } from '../lib/videoReviewUpload';
import '../styles/video-review.css';

export default function VideoReviewUploadPage() {
  const navigate = useNavigate();
  const [gameId, setGameId] = useState('local-video-review');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!file || !gameId.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const impressionId = await uploadVideoReview({
        file,
        gameId: gameId.trim(),
        text,
        onProgress: setProgress,
      });
      navigate(`/impressions/${impressionId}`);
    } catch (uploadError) {
      setError(uploadError.message || '動画レビューを作成できませんでした。');
      setSubmitting(false);
    }
  }

  return (
    <section className="video-review-page">
      <div>
        <h2>動画レビュー</h2>
        <p className="video-review-muted">ローカルに録画したプレイ動画をアップロードし、感情が動いた位置を自分で記録します。</p>
      </div>

      <form className="card video-review-form" onSubmit={submit}>
        <label>
          ゲーム ID
          <input value={gameId} maxLength={200} disabled={submitting} onChange={(event) => setGameId(event.target.value)} required />
        </label>
        <label>
          全体の感想（任意）
          <textarea value={text} maxLength={2000} rows={4} disabled={submitting} onChange={(event) => setText(event.target.value)} />
        </label>
        <label>
          プレイ動画
          <input
            type="file"
            accept="video/mp4,video/webm,video/x-matroska,.mkv"
            disabled={submitting}
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            required
          />
        </label>
        <p className="video-review-muted">MP4 / MKV / WebM、200MB・2時間まで。処理後にスタンプを記録できます。</p>
        {error && <div className="error-message">{error}</div>}
        {submitting && <p className="video-review-progress">{progress}</p>}
        <button className="btn-primary" type="submit" disabled={submitting || !file || !gameId.trim()}>
          {submitting ? '作成中…' : '動画レビューを作成'}
        </button>
      </form>
    </section>
  );
}
