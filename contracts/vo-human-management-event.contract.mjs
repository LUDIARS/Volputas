export default {
  post: (event, impression) => (
    event.event_key === `vo:play-impression:${impression.id}`
    && event.source === 'vo' && event.kind === 'play-impression' && event.origin === 'human'
    && event.summary === 'プレイ感想が保存されました。'
    && event.target_key.startsWith('game/')
    && event.observed_at === new Date(impression.captured_at ?? impression.created_at).getTime()
    && Object.keys(event).sort().join(',') === 'event_key,kind,observed_at,origin,project_code,source,summary,target_key'
  ) || 'Human event must contain the fixed receipt and only CC-MGMT-02 fields',
};
