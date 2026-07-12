const ALLOWED_PROFILE_FIELDS = [
  'sub',
  'id',
  'name',
  'username',
  'picture',
  'avatar',
  'email',
  'email_verified',
  'locale',
];

function pickProfileFields(_provider, userInfo) {
  if (!userInfo || typeof userInfo !== 'object' || Array.isArray(userInfo)) return {};
  const profile = {};
  for (const key of ALLOWED_PROFILE_FIELDS) {
    if (userInfo[key] !== undefined) profile[key] = userInfo[key];
  }
  return profile;
}

module.exports = { ALLOWED_PROFILE_FIELDS, pickProfileFields };
