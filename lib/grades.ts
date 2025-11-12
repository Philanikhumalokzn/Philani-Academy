export const GRADE_VALUES = ['GRADE_8', 'GRADE_9', 'GRADE_10', 'GRADE_11', 'GRADE_12'] as const
export type GradeValue = typeof GRADE_VALUES[number]

export function normalizeGradeInput(input?: string | null): GradeValue | undefined {
  if (!input) return undefined
  const upper = input.trim().toUpperCase().replace(/[\s-]+/g, '_')
  if ((GRADE_VALUES as readonly string[]).includes(upper)) return upper as GradeValue
  const digits = input.replace(/[^0-9]/g, '')
  if (digits) {
    const candidate = `GRADE_${digits}`
    if ((GRADE_VALUES as readonly string[]).includes(candidate)) return candidate as GradeValue
  }
  return undefined
}

export function gradeToLabel(value?: string | null): string {
  switch (value) {
    case 'GRADE_8':
      return 'Grade 8'
    case 'GRADE_9':
      return 'Grade 9'
    case 'GRADE_10':
      return 'Grade 10'
    case 'GRADE_11':
      return 'Grade 11'
    case 'GRADE_12':
      return 'Grade 12'
    default:
      return 'Unassigned'
  }
}
