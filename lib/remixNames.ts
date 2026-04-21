export type RemixNameSignature = {
  year: string
  month: string
  paper: string
  topic: string
  level: string
}

export type ResolvedRemixName = {
  displayName: string
  suggestedName: string
  isManualName: boolean
}

const MONTH_ABBREVIATIONS: Record<string, string> = {
  january: 'Jan',
  jan: 'Jan',
  february: 'Feb',
  feb: 'Feb',
  march: 'Mar',
  mar: 'Mar',
  april: 'Apr',
  apr: 'Apr',
  may: 'May',
  june: 'Jun',
  jun: 'Jun',
  july: 'Jul',
  jul: 'Jul',
  august: 'Aug',
  aug: 'Aug',
  september: 'Sep',
  sept: 'Sep',
  sep: 'Sep',
  october: 'Oct',
  oct: 'Oct',
  november: 'Nov',
  nov: 'Nov',
  december: 'Dec',
  dec: 'Dec',
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeLookupKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function abbreviateMonthLabel(month: string): string {
  const normalizedMonth = normalizeText(month)
  if (!normalizedMonth) return ''
  const lookupKey = normalizeLookupKey(normalizedMonth)
  return MONTH_ABBREVIATIONS[lookupKey] || normalizedMonth
}

export function buildSuggestedRemixName(signature: RemixNameSignature): string {
  const year = normalizeText(signature.year)
  const month = abbreviateMonthLabel(normalizeText(signature.month))
  const paper = normalizeText(signature.paper)
  const topic = normalizeText(signature.topic)
  const level = normalizeText(signature.level)

  const parts = [
    year,
    month,
    paper ? `P${paper}` : '',
    topic,
    level ? `Lvl ${level}` : '',
  ].filter(Boolean)

  return parts.join(' ')
}

export function buildCompactRemixName(signature: RemixNameSignature): string {
  const suggestedName = buildSuggestedRemixName(signature)
  return suggestedName || 'Mixed Remix'
}

function buildPreviousCompactRemixName(signature: RemixNameSignature): string {
  const year = normalizeText(signature.year)
  const paper = normalizeText(signature.paper)
  const topic = normalizeText(signature.topic)
  const level = normalizeText(signature.level)

  const legacyTopic = topic
    .replace(/\bAnalytical\b/gi, 'Anal')
    .replace(/\bGeometry\b/gi, 'Geo')
    .replace(/\bEuclidean\b/gi, 'Euclid')
    .replace(/\bStraight Line\b/gi, 'Line')
    .replace(/\bFinancial Mathematics\b/gi, 'Fin Maths')
    .replace(/\bFunctions\b/gi, 'Func')
    .replace(/\bPatterns\b/gi, 'Pat')
    .replace(/\s+/g, ' ')
    .trim()

  const parts = [
    year,
    paper ? `P${paper}` : '',
    legacyTopic,
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
  nameManuallySet?: boolean | null,
): string {
  return resolveRemixName(storedName, signature, creatorLabel, nameManuallySet).displayName
}

export function resolveRemixName(
  storedName: string | null | undefined,
  signature: RemixNameSignature,
  creatorLabel?: string | null,
  nameManuallySet?: boolean | null,
): ResolvedRemixName {
  const normalizedStoredName = normalizeText(storedName)
  const suggestedName = buildSuggestedRemixName(signature)

  const legacyWithCreator = buildLegacyAutoRemixName(signature, creatorLabel)
  const legacyWithoutCreator = buildLegacyAutoRemixName(signature)
  const previousCompactName = buildPreviousCompactRemixName(signature)
  const compactName = buildCompactRemixName(signature)

  const matchesAutoPattern = normalizedStoredName !== '' && (
    normalizedStoredName === suggestedName
    || normalizedStoredName === compactName
    || normalizedStoredName === legacyWithCreator
    || normalizedStoredName === legacyWithoutCreator
    || normalizedStoredName === previousCompactName
  )

  const isManualName = typeof nameManuallySet === 'boolean'
    ? nameManuallySet
    : Boolean(normalizedStoredName) && !matchesAutoPattern

  if (isManualName) {
    return {
      displayName: normalizedStoredName || suggestedName || 'Untitled remix',
      suggestedName,
      isManualName: true,
    }
  }

  return {
    displayName: suggestedName || normalizedStoredName || 'Untitled remix',
    suggestedName,
    isManualName: false,
  }
}