export default {
  post: (event, review) => (
    event.source === 'vo'
    && event.kind === 'ai-playtest-review'
    && event.origin === 'ai'
    && event.event_key.startsWith('vo:ai-playtest:')
    && (/^[A-Za-z0-9._:/#-]{1,185}$/.test(review.run_id)
      ? event.event_key === `vo:ai-playtest:${review.run_id}` : event.event_key.length <= 200)
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(event.project_code)
    && event.target_key.startsWith('game/')
    && event.observed_at === new Date(review.played_at ?? review.created_at).getTime()
    && event.summary.length > 0 && event.summary.length <= 2000
    && Object.keys(event).sort().join(',') === 'event_key,kind,observed_at,origin,project_code,source,summary,target_key'
  ) || 'AI event must preserve its stable identity and satisfy the CC-MGMT-02 allowlist',
};
