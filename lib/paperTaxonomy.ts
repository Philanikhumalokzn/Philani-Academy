export const EXAM_CYCLE_VALUES = ['FINAL', 'PRELIM', 'QUARTERLY', 'COMMON_TEST', 'SUPPLEMENTARY', 'INTERNAL'] as const
export type ExamCycleValue = typeof EXAM_CYCLE_VALUES[number]

export const PAPER_MODE_VALUES = ['P1', 'P2', 'P3', 'COMBINED', 'UNKNOWN'] as const
export type PaperModeValue = typeof PAPER_MODE_VALUES[number]

export const AUTHORITY_SCOPE_VALUES = ['NATIONAL', 'PROVINCIAL', 'DISTRICT', 'SCHOOL', 'INTERNAL'] as const
export type AuthorityScopeValue = typeof AUTHORITY_SCOPE_VALUES[number]

export const ASSESSMENT_TYPE_VALUES = ['EXAM', 'TEST', 'ASSIGNMENT', 'WORKSHEET', 'QUIZ', 'UNKNOWN'] as const
export type AssessmentTypeValue = typeof ASSESSMENT_TYPE_VALUES[number]

export const ASSESSMENT_FORMALITY_VALUES = ['FORMAL', 'INFORMAL', 'UNKNOWN'] as const
export type AssessmentFormalityValue = typeof ASSESSMENT_FORMALITY_VALUES[number]

const normalizeKey = (value: unknown) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')

export function normalizeEnumValue<T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  const key = normalizeKey(value)
  if (!key) return undefined
  return (allowed as readonly string[]).includes(key) ? (key as T[number]) : undefined
}

export function normalizePaperNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  if (!Number.isFinite(numeric)) return undefined
  const rounded = Math.trunc(Number(numeric))
  if (rounded < 0 || rounded > 3) return undefined
  return rounded
}

export function inferPaperMode(paper: number | undefined, explicitMode?: PaperModeValue): PaperModeValue {
  if (explicitMode) return explicitMode
  if (paper === 1) return 'P1'
  if (paper === 2) return 'P2'
  if (paper === 3) return 'P3'
  if (paper === 0) return 'COMBINED'
  return 'UNKNOWN'
}

export function normalizeProvince(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  return raw.slice(0, 80)
}

export function normalizeSourceName(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  return raw.slice(0, 160)
}

export function normalizePaperLabelRaw(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  return raw.slice(0, 80)
}
