import { useEffect, useState } from 'react';
import ProfileFeatureLayout from '../components/ProfileFeatureLayout';
import ProfileField from '../components/ProfileField';
import ProfileMedia from '../components/ProfileMedia';
import { useProfileClient } from '../lib/profileClient';

const INITIAL_FORM = {
  gameTitle: '',
  platform: '',
  playtimeHours: '',
  completionPercent: '',
  achievementsUnlocked: '',
  achievementsTotal: '',
  selfRatedMastery: '',
  userInfo: '',
};

function confidenceLabel(value) {
  return {
    high: '根拠 多',
    medium: '根拠 中',
    low: '根拠 少',
    'needs-details': '追加情報が必要',
  }[value] || value;
}

export default function GameplayPage() {
  const client = useProfileClient();
  const [form, setForm] = useState(INITIAL_FORM);
  const [file, setFile] = useState(null);
  const [records, setRecords] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    client.list('gameplay').then(setRecords).catch((reason) => setError(reason.message));
  }, [client]);

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await client.create(
        'gameplay',
        { ...form, screenshotFileName: file?.name || '' }
      );
      if (file) {
        try {
          await client.upload('screenshots', result.record.id, file);
        } catch (uploadError) {
          throw new Error(`記録は保存しましたが画像を保存できませんでした: ${uploadError.message}`);
        }
      }
      setRecords((current) => [result.record, ...current]);
      setForm(INITIAL_FORM);
      setFile(null);
      formElement.reset();
      setSuccess(`「${result.record.gameTitle}」のゲームプレイ情報を保存しました。`);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  }

  const entryForm = (
    <form onSubmit={submit}>
      <h3>ゲームプレイ情報を登録</h3>
      <p className="form-intro">
        スクリーンショットは根拠資料として保存します。数値を入力するとやりこみ度を算出できます。
      </p>
      <ProfileField label="ゲーム名">
        <input name="gameTitle" value={form.gameTitle} onChange={update} required />
      </ProfileField>
      <ProfileField label="プラットフォーム">
        <input name="platform" value={form.platform} onChange={update} placeholder="Steam / PS5 など" />
      </ProfileField>
      <div className="profile-field-row">
        <ProfileField label="プレイ時間">
          <input name="playtimeHours" type="number" min="0" step="0.1" value={form.playtimeHours} onChange={update} placeholder="時間" />
        </ProfileField>
        <ProfileField label="達成率">
          <input name="completionPercent" type="number" min="0" max="100" value={form.completionPercent} onChange={update} placeholder="%" />
        </ProfileField>
      </div>
      <div className="profile-field-row">
        <ProfileField label="解除実績">
          <input name="achievementsUnlocked" type="number" min="0" value={form.achievementsUnlocked} onChange={update} />
        </ProfileField>
        <ProfileField label="実績総数">
          <input name="achievementsTotal" type="number" min="0" value={form.achievementsTotal} onChange={update} />
        </ProfileField>
      </div>
      <ProfileField label="自己評価の習熟度">
        <select name="selfRatedMastery" value={form.selfRatedMastery} onChange={update}>
          <option value="">未入力</option>
          {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}
        </select>
      </ProfileField>
      <ProfileField label="ユーザ情報・画面から読み取れる情報">
        <textarea name="userInfo" rows="4" value={form.userInfo} onChange={update} />
      </ProfileField>
      <ProfileField label="スクリーンショット" hint="PNG / JPEG / WebP、最大20MB">
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files[0] || null)} />
      </ProfileField>
      <button className="btn-primary" disabled={saving}>{saving ? '保存中…' : '登録する'}</button>
    </form>
  );

  return (
    <ProfileFeatureLayout
      title="ゲームプレイ情報"
      description="ゲームごとのプレイ状況を記録し、入力根拠からやりこみ度を可視化します。"
      form={entryForm}
      records={records}
      error={error}
      success={success}
      emptyMessage="ゲームプレイ情報はまだありません。"
      renderRecord={(record) => (
        <article className="card profile-record" key={record.id}>
          <div className="record-heading">
            <div>
              <h4>{record.gameTitle}</h4>
              <span>{record.platform || 'プラットフォーム未設定'}</span>
            </div>
            <div className="dedication-score">
              <strong>{record.dedication?.score ?? '—'}</strong><span>/ 100</span>
            </div>
          </div>
          <div className="tags-row">
            <span className="tag">{confidenceLabel(record.dedication?.confidence)}</span>
            {record.playtimeHours !== null && <span className="tag">{record.playtimeHours}時間</span>}
            {record.completionPercent !== null && <span className="tag">達成 {record.completionPercent}%</span>}
          </div>
          {record.screenshotFileName && (
            <ProfileMedia
              className="gameplay-screenshot"
              kind="screenshots"
              recordId={record.id}
              alt={`${record.gameTitle} screenshot`}
            />
          )}
          {record.userInfo && <p className="record-comment">{record.userInfo}</p>}
        </article>
      )}
    />
  );
}
