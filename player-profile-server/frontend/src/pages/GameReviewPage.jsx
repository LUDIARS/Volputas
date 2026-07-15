import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { submitGameReview } from '../lib/gameReview';
import '../styles/video-review.css';

export default function GameReviewPage() {
  const navigate = useNavigate();
  const [gameName, setGameName] = useState('');
  const [gameKind, setGameKind] = useState('developed');
  const [rating, setRating] = useState('5');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const impressionId = await submitGameReview({ gameName, gameKind, rating, text });
      navigate(`/impressions/${impressionId}`);
    } catch (submitError) {
      setError(submitError.message || 'ゲームレビューを投稿できませんでした。');
      setSubmitting(false);
    }
  }

  return (
    <section className="video-review-page">
      <div>
        <h2>ゲームレビュー</h2>
        <p className="video-review-muted">
          自分たちで開発したゲームでも、市販のゲームでもレビューできます。
        </p>
      </div>

      <form className="card video-review-form" onSubmit={submit}>
        <label>
          ゲーム名
          <input
            value={gameName}
            maxLength={100}
            disabled={submitting}
            onChange={(event) => setGameName(event.target.value)}
            required
          />
        </label>
        <label>
          ゲームの区分
          <select
            value={gameKind}
            disabled={submitting}
            onChange={(event) => setGameKind(event.target.value)}
          >
            <option value="developed">開発したゲーム</option>
            <option value="commercial">市販のゲーム</option>
          </select>
        </label>
        <label>
          評価
          <select
            value={rating}
            disabled={submitting}
            onChange={(event) => setRating(event.target.value)}
          >
            <option value="5">5 - とても良い</option>
            <option value="4">4 - 良い</option>
            <option value="3">3 - 普通</option>
            <option value="2">2 - あまり良くない</option>
            <option value="1">1 - 良くない</option>
          </select>
        </label>
        <label>
          レビュー本文
          <textarea
            value={text}
            maxLength={2000}
            rows={8}
            disabled={submitting}
            onChange={(event) => setText(event.target.value)}
            required
          />
        </label>
        {error && <div className="error-message">{error}</div>}
        <button
          className="btn-primary"
          type="submit"
          disabled={submitting || !gameName.trim() || !text.trim()}
        >
          {submitting ? '投稿中…' : 'ゲームレビューを投稿'}
        </button>
      </form>
    </section>
  );
}
