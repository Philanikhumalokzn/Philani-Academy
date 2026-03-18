import type { HandwritingAnalysis, LegoBrickFamilyKind, LegoBrickPrototypeKind } from './types'

export type BrickFamilyScoreEntry = {
  family: LegoBrickFamilyKind
  prototype: LegoBrickPrototypeKind
  score: number
  evidence: string[]
}

export type BrickFamilyGroupDiagnostics = {
  groupId: string
  finalRole: string | null
  qualifiedRoleLabel: string | null
  marginToRunnerUp: number | null
  isBorderline: boolean
  topFamilies: BrickFamilyScoreEntry[]
}

export type BrickFamilyDiagnosticsOptions = {
  topK?: number
  borderlineGap?: number
}

const DEFAULT_TOP_K = 3
const DEFAULT_BORDERLINE_GAP = 0.18

export const collectBrickFamilyScoreDiagnostics = (
  analysis: HandwritingAnalysis,
  options: BrickFamilyDiagnosticsOptions = {},
): BrickFamilyGroupDiagnostics[] => {
  const topK = options.topK ?? DEFAULT_TOP_K
  const borderlineGap = options.borderlineGap ?? DEFAULT_BORDERLINE_GAP

  return analysis.groups.map((group) => {
    const role = analysis.roles.find((candidate) => candidate.groupId === group.id) || null
    const hypotheses = analysis.brickHypotheses
      .filter((hypothesis) => hypothesis.groupId === group.id)
      .sort((left, right) => right.score - left.score)
    const topFamilies = hypotheses.slice(0, topK).map((hypothesis) => ({
      family: hypothesis.family,
      prototype: hypothesis.prototype,
      score: hypothesis.score,
      evidence: hypothesis.evidence.slice(0, 3),
    }))
    const topScore = topFamilies[0]?.score ?? 0
    const runnerUpScore = topFamilies[1]?.score ?? 0
    const marginToRunnerUp = topFamilies.length >= 2 ? topScore - runnerUpScore : null

    return {
      groupId: group.id,
      finalRole: role?.role || null,
      qualifiedRoleLabel: role?.qualifiedRoleLabel || null,
      marginToRunnerUp,
      isBorderline: marginToRunnerUp !== null && marginToRunnerUp <= borderlineGap,
      topFamilies,
    }
  })
}

export const formatBrickFamilyScoreDiagnostics = (
  analysis: HandwritingAnalysis,
  options: BrickFamilyDiagnosticsOptions = {},
) => {
  const diagnostics = collectBrickFamilyScoreDiagnostics(analysis, options)

  return diagnostics
    .map((entry) => {
      const header = [
        `group=${entry.groupId}`,
        `finalRole=${entry.finalRole || 'none'}`,
        `qualifiedRole=${entry.qualifiedRoleLabel || 'none'}`,
        `runnerUpGap=${entry.marginToRunnerUp === null ? 'n/a' : entry.marginToRunnerUp.toFixed(3)}`,
        `borderline=${String(entry.isBorderline)}`,
      ].join(' | ')

      const families = entry.topFamilies.map((family, index) => {
        const evidence = family.evidence.length ? ` evidence=${family.evidence.join('; ')}` : ''
        return `${index + 1}. ${family.family} score=${family.score.toFixed(3)} prototype=${family.prototype}${evidence}`
      })

      return [header, ...families].join('\n')
    })
    .join('\n\n')
}