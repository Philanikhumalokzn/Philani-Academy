export type RemixNameSignature = {
  year: string
  month: string
  paper: string
  topic: string
  level: string
}

const TOPIC_PHRASE_ABBREVIATIONS: Record<string, string> = {
  'analytical geometry': 'Anal Geo',
  'euclidean geometry': 'Euclid Geo',
  'straight line geometry': 'Line Geo',
  'number patterns': 'Num Pat',
  'number patterns sequences and series': 'Num Pat Seq',
  'sequences and series': 'Seq Series',
  'functions and graphs': 'Func Graphs',
  'data handling': 'Data',
  'financial mathematics': 'Fin Maths',
  'financial maths': 'Fin Maths',
}

const TOPIC_WORD_ABBREVIATIONS: Record<string, string> = {
  analytical: 'Anal',
  geometry: 'Geo',
  euclidean: 'Euclid',
  straight: 'Line',
  line: 'Line',
  trigonometry: 'Trig',
  probability: 'Prob',
  statistics: 'Stats',
  measurement: 'Meas',
  financial: 'Fin',
  mathematics: 'Maths',
  maths: 'Maths',
  functions: 'Func',
  function: 'Func',
  graphs: 'Graphs',
  graph: 'Graph',
  calculus: 'Calc',
  differentiation: 'Diff',
  derivatives: 'Diff',
  derivative: 'Diff',
  integration: 'Int',
  algebraic: 'Alg',
  algebra: 'Alg',
  expressions: 'Expr',
  expression: 'Expr',
  equations: 'Eqns',
  equation: 'Eqn',
  inequalities: 'Ineq',
  inequality: 'Ineq',
  sequences: 'Seq',
  sequence: 'Seq',
  series: 'Series',
  patterns: 'Pat',
  pattern: 'Pat',
  number: 'Num',
  transformation: 'Trans',
  transformations: 'Trans',
  coordinate: 'Coord',
  coordinates: 'Coords',
}

const STOP_WORDS = new Set(['and', 'of', 'the', 'to', 'for'])

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTopicKey(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toTitleCase(word: string): string {
  if (!word) return ''
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

export function abbreviateTopicLabel(topic: string): string {
  const normalizedTopic = normalizeText(topic)
  if (!normalizedTopic) return ''

  const topicKey = normalizeTopicKey(normalizedTopic)
  if (TOPIC_PHRASE_ABBREVIATIONS[topicKey]) return TOPIC_PHRASE_ABBREVIATIONS[topicKey]

  const abbreviatedWords = topicKey
    .split(' ')
    .filter(Boolean)
    .filter((word) => !STOP_WORDS.has(word))
    .map((word) => TOPIC_WORD_ABBREVIATIONS[word] || toTitleCase(word))

  return abbreviatedWords.join(' ').trim()
}

export function buildCompactRemixName(signature: RemixNameSignature): string {
  const year = normalizeText(signature.year)
  const paper = normalizeText(signature.paper)
  const topic = abbreviateTopicLabel(normalizeText(signature.topic))
  const level = normalizeText(signature.level)

  const parts = [
    year,
    paper ? `P${paper}` : '',
    topic,
    level ? `Lev ${level}` : '',
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' ') : 'Mixed Remix'
}

export function buildLegacyAutoRemixName(signature: RemixNameSignature, creatorLabel?: string | null): string {
  const parts = [
    normalizeText(signature.year),
    normalizeText(signature.month),
    normalizeText(signature.paper) ? `Paper ${normalizeText(signature.paper)}` : '',
    normalizeText(signature.topic),
    normalizeText(signature.level) ? `Level ${normalizeText(signature.level)}` : '',
  ].filter(Boolean)

  const creator = normalizeText(creatorLabel)
  return [...parts, creator].filter(Boolean).join(' · ')
}

export function getDisplayRemixName(
  storedName: string | null | undefined,
  signature: RemixNameSignature,
  creatorLabel?: string | null,
): string {
  const normalizedStoredName = normalizeText(storedName)
  const compactName = buildCompactRemixName(signature)
  if (!normalizedStoredName) return compactName

  const legacyWithCreator = buildLegacyAutoRemixName(signature, creatorLabel)
  const legacyWithoutCreator = buildLegacyAutoRemixName(signature)

  if (normalizedStoredName === legacyWithCreator || normalizedStoredName === legacyWithoutCreator) {
    return compactName
  }

  return normalizedStoredName
}