import { useEffect, useState } from 'react';
import { useProfileClient } from '../lib/profileClient';

export default function ProfileMedia({ as = 'img', kind, recordId, ...props }) {
  const client = useProfileClient();
  const [source, setSource] = useState('');

  useEffect(() => {
    let active = true;
    client.mediaUrl(kind, recordId)
      .then((url) => {
        if (active) setSource(url);
      })
      .catch(() => {
        if (active) setSource('');
      });
    return () => {
      active = false;
    };
  }, [client, kind, recordId]);

  if (!source) return <div className="media-loading">メディアを読み込み中…</div>;
  if (as === 'audio') return <audio {...props} src={source} />;
  if (as === 'video') return <video {...props} src={source} />;
  return <img {...props} src={source} />;
}
