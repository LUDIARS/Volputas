import { useEffect, useState } from 'react';
import ProfileFeatureLayout from '../components/ProfileFeatureLayout';
import ProfileField from '../components/ProfileField';
import ProfileMedia from '../components/ProfileMedia';
import { useProfileClient } from '../lib/profileClient';

const MOMENT_TYPES = {
  achievement: '達成',
  discovery: '発見',
  story: '物語',
  social: '交流',
  aesthetic: '美しさ',
};

const INITIAL_FORM = {
  momentType: 'achievement',
  caption: '',
};

export default function AnnotationPage() {
  const client = useProfileClient();
  const [form, setForm] = useState(INITIAL_FORM);
  const [file, setFile] = useState(null);
  const [records, setRecords] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    client.list('annotations').then(setRecords).catch((reason) => setError(reason.message));
  }, [client]);

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!file) {
      setError('注釈する画像を選択してください。');
      return;
    }
    const formElement = event.currentTarget;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await client.create('annotations', {
        ...form,
        screenshotFileName: file.name,
      });
      try {
        await client.upload('screenshots', result.record.id, file);
      } catch (uploadError) {
        throw new Error(`注釈は保存しましたが画像を保存できませんでした: ${uploadError.message}`);
      }
      setRecords((current) => [result.record, ...current]);
      setForm(INITIAL_FORM);
      setFile(null);
      formElement.reset();
      setSuccess('スクリーンショット注釈を保存しました。');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  }

  const entryForm = (
    <form onSubmit={submit}>
      <h3>残したい瞬間を登録</h3>
      <p className="form-intro">
        画像自体は機械解析せず、選んだ理由とキャプションだけをペルソナ分析に使います。
      </p>
      <ProfileField label="画像" hint="PNG / JPEG / WebP、最大20MB">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          required
          onChange={(event) => setFile(event.target.files[0] || null)}
        />
      </ProfileField>
      <ProfileField label="この瞬間を残した理由">
        <select name="momentType" value={form.momentType} onChange={update}>
          {Object.entries(MOMENT_TYPES).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </ProfileField>
      <ProfileField label="キャプション">
        <textarea
          name="caption"
          rows="5"
          value={form.caption}
          onChange={update}
          required
          placeholder="何が印象に残ったか、自分の言葉で記録します"
        />
      </ProfileField>
      <button className="btn-primary" disabled={saving}>
        {saving ? '保存中…' : '画像と注釈を保存する'}
      </button>
    </form>
  );

  return (
    <ProfileFeatureLayout
      title="スクリーンショット注釈"
      description="残したくなった瞬間から、達成・発見・物語・交流・美しさへの反応を記録します。"
      form={entryForm}
      records={records}
      error={error}
      success={success}
      emptyMessage="注釈付きスクリーンショットはまだありません。"
      renderRecord={(record) => (
        <article className="card profile-record annotation-record" key={record.id}>
          <div className="record-heading">
            <div>
              <h4>{MOMENT_TYPES[record.momentType] || record.momentType}</h4>
              <span>{record.screenshotFileName}</span>
            </div>
          </div>
          <ProfileMedia
            className="annotation-screenshot"
            kind="screenshots"
            recordId={record.id}
            alt={record.caption}
          />
          <p className="record-comment">{record.caption}</p>
        </article>
      )}
    />
  );
}
