export default function ProfileField({ label, hint, children }) {
  return (
    <label className="profile-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
