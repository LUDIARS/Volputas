// Vocabulary of the hobby classification patterns: type labels, the flat dimension list used
// for vector storage, and the schema exported to API consumers.
//
// Extracted from analysisEngine.js (which owns the DB-backed scoring) so that pure scoring
// modules and their tests can import the vocabulary without pulling in a database handle —
// same split as preferenceAxisDefinitions.js vs preferenceAxes.js.

// Pattern 1: Gamer Pattern
// Based on Magic: The Gathering psychographics (Timmy/Johnny/Spike + Vorthos/Melvin)
// Each main type has 4 subtypes
const GAMER_TYPES = {
  timmy: {
    label: 'Timmy/Tammy',
    description: 'Power gamer — seeks impressive, visceral experiences',
    subtypes: ['power', 'social', 'diversity', 'adrenaline'],
  },
  johnny: {
    label: 'Johnny/Jenny',
    description: 'Combo player — seeks creative self-expression',
    subtypes: ['combo', 'offbeat', 'uber', 'eliminator'],
  },
  spike: {
    label: 'Spike',
    description: 'Tournament player — seeks to prove ability through winning',
    subtypes: ['innovator', 'tuner', 'analyst', 'nut'],
  },
  vorthos: {
    label: 'Vorthos',
    description: 'Flavor enthusiast — values story, art, and world-building',
    subtypes: ['creative', 'collector', 'loremaster', 'cosplayer'],
  },
  melvin: {
    label: 'Melvin',
    description: 'Mechanics enthusiast — appreciates elegant system design',
    subtypes: ['designer', 'optimizer', 'theorist', 'completionist'],
  },
};

// Pattern 2: Mechanics Pattern
// Based on Roger Caillois' "Man and Play" (Les jeux et les hommes)
const MECHANICS_TYPES = {
  agon: {
    label: 'Agon',
    description: 'Competition — structured contests of skill and merit',
  },
  alea: {
    label: 'Alea',
    description: 'Chance/Luck — outcomes determined by fortune and randomness',
  },
  ilinx: {
    label: 'Ilinx',
    description: 'Vertigo/Thrill — pursuit of disorientation and altered perception',
  },
  mimicry: {
    label: 'Mimicry',
    description: 'Imitation/Roleplay — becoming another through simulation',
  },
};

// Pattern 3: Story Dynamics
// Based on Eric Berne's life scripts (Transactional Analysis)
const STORY_TYPES = {
  winner: {
    label: 'Winner Script',
    description: 'Pursues goals and achieves them — growth-oriented narrative',
  },
  banal: {
    label: 'Banal Script',
    description: 'Follows conventional paths — stability-oriented narrative',
  },
  loser: {
    label: 'Loser Script',
    description: 'Faces setbacks as recurring theme — conflict-oriented narrative',
  },
};

// =============================================================================
// Classification Dimensions (flat list for vector storage)
// =============================================================================

const DIMENSIONS = [
  // Gamer Pattern (5 main types)
  'gamer_timmy',
  'gamer_johnny',
  'gamer_spike',
  'gamer_vorthos',
  'gamer_melvin',
  // Mechanics Pattern (4 types)
  'mechanics_agon',
  'mechanics_alea',
  'mechanics_ilinx',
  'mechanics_mimicry',
  // Story Dynamics (3 types)
  'story_winner',
  'story_banal',
  'story_loser',
];

// =============================================================================
// Classification Schema (exported for API consumers)
// =============================================================================

const CLASSIFICATION_SCHEMA = {
  gamer: {
    label: 'Gamer Pattern',
    description: 'MTG psychographic profiles — how and why you play',
    types: GAMER_TYPES,
    dimensions: ['gamer_timmy', 'gamer_johnny', 'gamer_spike', 'gamer_vorthos', 'gamer_melvin'],
  },
  mechanics: {
    label: 'Mechanics Pattern',
    description: "Caillois' play categories — what kind of play attracts you",
    types: MECHANICS_TYPES,
    dimensions: ['mechanics_agon', 'mechanics_alea', 'mechanics_ilinx', 'mechanics_mimicry'],
  },
  story: {
    label: 'Story Dynamics',
    description: "Berne's life scripts — what narrative arc drives you",
    types: STORY_TYPES,
    dimensions: ['story_winner', 'story_banal', 'story_loser'],
  },
};

// Flat `<mainType>.<subtype>` keys — the vocabulary survey questions tag themselves with
// (`subtype:` in src/surveys/gamerSubtypesSurvey.js) and subtypeScoring.js aggregates by.
const GAMER_SUBTYPE_KEYS = Object.freeze(
  Object.entries(GAMER_TYPES).flatMap(
    ([typeKey, type]) => type.subtypes.map((subtype) => `${typeKey}.${subtype}`)
  )
);

module.exports = {
  CLASSIFICATION_SCHEMA,
  DIMENSIONS,
  GAMER_SUBTYPE_KEYS,
  GAMER_TYPES,
  MECHANICS_TYPES,
  STORY_TYPES,
};
