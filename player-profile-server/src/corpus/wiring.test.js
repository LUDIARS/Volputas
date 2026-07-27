const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const packageRoot = resolve(__dirname, '..', '..');
const repositoryRoot = resolve(packageRoot, '..');

test('mounts the manifest and protected GLAB survey backend routes', () => {
  const appSource = readFileSync(resolve(packageRoot, 'src', 'app.js'), 'utf8');
  const corpusRouteIndex = appSource.indexOf(
    "'/api/v1/integrations/glab/surveys'",
  );
  const preBodyLimiterIndex = appSource.indexOf(
    'app.use(glabSurveyPath, createCorpusTransportRateLimiter())',
  );
  const bodyParserIndex = appSource.indexOf("express.json({ limit: '1mb' })");
  const protectedRouterIndex = appSource.indexOf('createGlabSurveyRouter({');
  const generalLimiterIndex = appSource.indexOf('// General rate limiter');
  const jwtRouterIndex = appSource.indexOf("app.use('/api/v1', timelineRoutes)");

  assert.match(appSource, /\/\.well-known\/corpus-service\.json/);
  assert.match(appSource, /\/api\/v1\/integrations\/glab\/surveys/);
  assert.match(
    appSource,
    /createGlabSurveyRouter\(\{[\s\S]*serviceProvider: getGlabSurveyService,[\s\S]*transportRateLimiter: null/,
  );
  assert.ok(corpusRouteIndex >= 0);
  assert.ok(
    preBodyLimiterIndex >= 0 && preBodyLimiterIndex < bodyParserIndex,
    'Corpus transport limiting must run before parsing request bodies',
  );
  assert.ok(
    bodyParserIndex < protectedRouterIndex,
    'Corpus authentication router must receive normalized parsed JSON',
  );
  assert.ok(
    corpusRouteIndex < generalLimiterIndex,
    'Corpus users must not share the general proxy-IP rate-limit bucket',
  );
  assert.ok(
    corpusRouteIndex < jwtRouterIndex,
    'Cernere integration route must run before the catch-all Voluptas JWT router',
  );
});

test('keeps frontend build ownership out of the Volputas backend component', () => {
  const catalog = readFileSync(
    resolve(repositoryRoot, 'excubitor.catalog.yaml'),
    'utf8',
  );
  assert.match(catalog, /component:\s*backend/);
  assert.doesNotMatch(catalog, /build_command:\s*npm --prefix frontend/);
});

test('adds an allowlisted, opt-in survey catalog without moving response ownership', () => {
  const migration = readFileSync(
    resolve(packageRoot, 'migrations', '009_corpus_survey_catalog.sql'),
    'utf8',
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS visible_to_glab BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /ALTER COLUMN visible_to_glab SET DEFAULT false/);
  assert.match(migration, /UPDATE surveys\s+SET visible_to_glab = false/);
  assert.match(
    migration,
    /CHECK \(category IN \('game_review', 'game_survey', 'peer_question'\)\)/,
  );
  assert.match(migration, /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*survey_responses/i);
});

test('runs database migrations before managed backend startup', () => {
  const packageDocument = JSON.parse(readFileSync(
    resolve(packageRoot, 'package.json'),
    'utf8',
  ));
  assert.equal(packageDocument.scripts.predev, 'npm run migrate');
  assert.equal(packageDocument.scripts.prestart, 'npm run migrate');
});

test('terminal signals finish owned shutdown before exiting the process', () => {
  const appSource = readFileSync(resolve(packageRoot, 'src', 'app.js'), 'utf8');
  assert.match(
    appSource,
    /stop\(\)\.then\([\s\S]*process\.exit\(0\)[\s\S]*process\.exit\(1\)/,
  );
  assert.match(appSource, /process\.once\('SIGINT', shutdown\)/);
  assert.match(appSource, /process\.once\('SIGTERM', shutdown\)/);
});
