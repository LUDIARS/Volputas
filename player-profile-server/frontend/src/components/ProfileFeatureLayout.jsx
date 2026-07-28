export default function ProfileFeatureLayout({
  title,
  description,
  form,
  records,
  renderRecord,
  emptyMessage,
  error,
  success,
}) {
  return (
    <div>
      <div className="page-header">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}
      <div className="profile-feature-grid">
        <section className="card profile-entry-form">{form}</section>
        <section className="profile-records">
          <h3>登録済み</h3>
          {records.length === 0 ? (
            <div className="card empty-state">{emptyMessage}</div>
          ) : records.map(renderRecord)}
        </section>
      </div>
    </div>
  );
}
