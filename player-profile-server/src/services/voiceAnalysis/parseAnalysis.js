const { AXIS_BY_ID } = require('./catalog');
const { invalid, boundedText, boundedArray, resolveEvidence } = require('./evidence');

const STATES = ['observed', 'not_experienced', 'not_applicable', 'unresolved'];
const VALENCES = ['negative', 'neutral', 'positive'];

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
function identifier(value, seen) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(value) || seen.has(value)) throw invalid();
  seen.add(value);
  return value;
}

/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
function parseAnalysis(text, sources) {
  if (typeof text !== 'string' || text.length > 100000) throw invalid();
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let raw;
  try { raw = JSON.parse(cleaned); } catch { throw invalid(); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid();
  const eventIds = new Set();
  const events = boundedArray(raw.events, 24).map((event) => {
    if (!event || typeof event !== 'object') throw invalid();
    const valence = event.valence ?? null;
    if (valence !== null && !VALENCES.includes(valence)) throw invalid();
    return {
      id: identifier(event.id, eventIds), label: boundedText(event.label),
      evidence: resolveEvidence(event.evidence, sources),
      valence,
      valenceEvidence: valence === null ? null : resolveEvidence(event.valenceEvidence, sources),
    };
  });
  const observationIds = new Set();
  const observations = boundedArray(raw.observations, 100).map((item) => {
    if (!item || typeof item !== 'object') throw invalid();
    const axis = AXIS_BY_ID.get(item.axisId);
    if (!axis || !STATES.includes(item.status)) throw invalid();
    if (item.status === 'observed' ? !axis.values.includes(item.value) : item.value !== null) throw invalid();
    if (item.eventId !== null && item.eventId !== undefined && !eventIds.has(item.eventId)) throw invalid();
    return {
      id: identifier(item.id, observationIds), axisId: axis.id,
      status: item.status, value: item.value, eventId: item.eventId ?? null,
      measurementMethod: 'explicit_text', calibratedConfidence: null,
      evidence: resolveEvidence(item.evidence, sources),
    };
  });
  const edgesSeen = new Set();
  const order = boundedArray(raw.order, 48).map((edge) => {
    if (!edge || !eventIds.has(edge.from) || !eventIds.has(edge.to) || edge.from === edge.to) throw invalid();
    const key = `${edge.from}:${edge.to}`;
    if (edgesSeen.has(key)) throw invalid();
    edgesSeen.add(key);
    return { from: edge.from, to: edge.to, evidence: resolveEvidence(edge.evidence, sources) };
  });
  // A cycle contradicts the claimed chronology; never silently reorder it.
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw invalid();
    if (visited.has(id)) return;
    visiting.add(id);
    order.filter((edge) => edge.from === id).forEach((edge) => visit(edge.to));
    visiting.delete(id);
    visited.add(id);
  }
  eventIds.forEach(visit);
  const byId = new Map(observations.map((item) => [item.id, item]));
  const links = boundedArray(raw.links, 32).map((link) => {
    const d = byId.get(link?.dObservationId);
    const a = byId.get(link?.aObservationId);
    if (!d || !a || !d.axisId.startsWith('d.') || !a.axisId.startsWith('a.')
      || d.status !== 'observed' || a.status !== 'observed') throw invalid();
    return {
      dObservationId: d.id, aObservationId: a.id, relation: 'reported_link',
      causality: 'not_verified', evidence: resolveEvidence(link.evidence, sources),
    };
  });
  const unclassified = boundedArray(raw.unclassified, 24).map((item) => ({
    label: boundedText(item?.label), evidence: resolveEvidence(item?.evidence, sources),
  }));
  return { observations, events, order, links, unclassified };
}

module.exports = { parseAnalysis };
