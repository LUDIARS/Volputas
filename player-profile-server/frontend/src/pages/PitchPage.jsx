import { useEffect, useState } from 'react';
import ProfileFeatureLayout from '../components/ProfileFeatureLayout';
import ProfileField from '../components/ProfileField';
import { useProfileClient } from '../lib/profileClient';

const INITIAL_FORM = {
  title: '',
  body: '',
  referenceGames: '',
};

export default function PitchPage() {
  const client = useProfileClient();
  const [form, setForm] = useState(INITIAL_FORM);
  const [records, setRecords] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    client.list('pitches').then(setRecords).catch((reason) => setError(reason.message));
  }, [client]);

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await client.create('pitches', form);
      setRecords((current) => [result.record, ...current]);
      setForm(INITIAL_FORM);
      setSuccess('理想のゲーム企画を保存しました。');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  }

  const entryForm = (
    <form onSubmit={submit}>
      <h3>企画を書く</h3>
      <p className="form-intro">
        遊びたいゲームを自由に書いてください。本文に含まれる Ludus 語彙を決定的に分析します。
      </p>
      <ProfileField label="タイトル">
        <input name="title" value={form.title} onChange={update} required maxLength="200" />
      </ProfileField>
      <ProfileField label="企画本文">
        <textarea
          name="body"
          rows="12"
          value={form.body}
          onChange={update}
          required
          maxLength="12000"
        />
      </ProfileField>
      <ProfileField label="参考ゲーム" hint="任意。ゲーム名や、参考にした点を記録できます。">
        <textarea
          name="referenceGames"
          rows="3"
          value={form.referenceGames}
          onChange={update}
          maxLength="1000"
        />
      </ProfileField>
      <button className="btn-primary" disabled={saving}>
        {saving ? '保存中…' : '企画を保存'}
      </button>
    </form>
  );

  return (
    <ProfileFeatureLayout
      title="理想のゲーム企画"
      description="自分が遊びたいゲームを設計し、創造性・自律性・メカニクス嗜好の evidence にします。"
      form={entryForm}
      records={records}
      error={error}
      success={success}
      emptyMessage="保存されたゲーム企画はまだありません。"
      renderRecord={(record) => (
        <article className="card profile-record" key={record.id}>
          <div className="record-heading">
            <h4>{record.title}</h4>
          </div>
          <p className="record-comment pitch-body">{record.body}</p>
          {record.referenceGames && (
            <p className="pitch-references">
              <strong>参考ゲーム:</strong> {record.referenceGames}
            </p>
          )}
        </article>
      )}
    />
  );
}
