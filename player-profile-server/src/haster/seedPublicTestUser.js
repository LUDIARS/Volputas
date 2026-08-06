const db = require('../config/database');
const {
  HASTER_PUBLIC_TEST_CERNERE_SUB,
  HASTER_PUBLIC_TEST_DISCORD_ID,
  HASTER_PUBLIC_TEST_USER_ID,
} = require('./publicTestIdentity');

// @implements SPEC-HASTER-PUBLIC-IDENTITY
async function seedHasterPublicTestUser(database = db) {
  await database.transaction(async (client) => {
    await client.query(
      `INSERT INTO users
         (id, display_name, locale, research_export_consent, discussion_import_consent, is_deleted)
       VALUES ($1, 'HASTER Public Test User', 'ja', true, true, false)
       ON CONFLICT (id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         locale = EXCLUDED.locale,
         research_export_consent = true,
         discussion_import_consent = true,
         is_deleted = false,
         updated_at = now()`,
      [HASTER_PUBLIC_TEST_USER_ID]
    );
    await client.query(
      `INSERT INTO federated_identities
         (user_id, provider, provider_sub, raw_profile, verified_at)
       VALUES ($1, 'discord', $2, $3::jsonb, now())
       ON CONFLICT (provider, provider_sub) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         raw_profile = EXCLUDED.raw_profile,
         verified_at = now()`,
      [
        HASTER_PUBLIC_TEST_USER_ID,
        HASTER_PUBLIC_TEST_DISCORD_ID,
        JSON.stringify({ fixture: 'haster-public-test-user', public: true }),
      ]
    );
    // The public fixture subject changed from a label to Cernere's UUID user
    // id. Remove only superseded Cernere identities for this fixture so an
    // existing HASTER database cannot resolve an arbitrary stale subject.
    await client.query(
      `DELETE FROM federated_identities
       WHERE user_id = $1 AND provider = 'cernere' AND provider_sub <> $2`,
      [HASTER_PUBLIC_TEST_USER_ID, HASTER_PUBLIC_TEST_CERNERE_SUB]
    );
    await client.query(
      `INSERT INTO federated_identities
         (user_id, provider, provider_sub, raw_profile, verified_at)
       VALUES ($1, 'cernere', $2, $3::jsonb, now())
       ON CONFLICT (provider, provider_sub) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         raw_profile = EXCLUDED.raw_profile,
         verified_at = now()`,
      [
        HASTER_PUBLIC_TEST_USER_ID,
        HASTER_PUBLIC_TEST_CERNERE_SUB,
        JSON.stringify({ fixture: 'haster-public-test-user', public: true }),
      ]
    );
  });
}

module.exports = { seedHasterPublicTestUser };
