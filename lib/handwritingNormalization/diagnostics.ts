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

export type StructuralRoleDiagnosticsEntry = {
  groupId: string
  role: string
  parentGroupId: string | null
  associationContextId: string | null
  hostedContextId: string | null
  hostedContextKind: string | null
  normalizationAnchorGroupIds: string[]
  evidence: string[]
}

export type StructuralRoleDiagnosticsOptions = {
  maxEvidence?: number
}

export type HostProtectionDiagnosticsOptions = {
  maxEvidence?: number
}

type HostProtectionRoleDiagnosticsEntry = {
  groupId: string
  role: string
  topFamily: LegoBrickFamilyKind | null
  topFamilyScore: number | null
  parentGroupId: string | null
  parentTopFamily: LegoBrickFamilyKind | null
  associationContextId: string | null
  hostedContextKind: string | null
  evidence: string[]
}

const DEFAULT_TOP_K = 3
const DEFAULT_BORDERLINE_GAP = 0.18
const DEFAULT_MAX_ROLE_EVIDENCE = 8
const HOST_PROTECTION_FAMILIES = new Set<LegoBrickFamilyKind>(['fractionBarBrick', 'radicalBrick', 'enclosureBoundaryBrick', 'operatorBrick'])

const isHostProtectionContextId = (contextId: string | null | undefined) => {
  return Boolean(contextId && (
    contextId.startsWith('context:fraction:')
    || contextId.startsWith('context:radical:')
    || contextId.startsWith('context:enclosure:')
  ))
}

const isHostProtectionEvidence = (evidence: string) => {
  return [
    'mutual-reinforcement=',
    'local-coherence=',
    'global-compatibility=',
    'revision-pressure=',
    'provisional-above=',
    'provisional-below=',
    'radicand-score=',
    'index-score=',
    'fraction-wide-promotion=',
    'promotion-kind=',
    'redirected-parent=',
    'hosted-context=',
    'association-context=context:fraction:',
    'association-context=context:radical:',
    'association-context=context:enclosure:',
  ].some((token) => evidence.includes(token))
}

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

export const collectStructuralRoleDiagnostics = (
  analysis: HandwritingAnalysis,
  options: StructuralRoleDiagnosticsOptions = {},
): StructuralRoleDiagnosticsEntry[] => {
  const maxEvidence = options.maxEvidence ?? DEFAULT_MAX_ROLE_EVIDENCE

  return analysis.roles
    .slice()
    .sort((left, right) => left.depth - right.depth || left.groupId.localeCompare(right.groupId))
    .map((role) => ({
      groupId: role.groupId,
      role: role.role,
      parentGroupId: role.parentGroupId || null,
      associationContextId: role.associationContextId || null,
      hostedContextId: role.hostedContextId || null,
      hostedContextKind: role.hostedContextKind || null,
      normalizationAnchorGroupIds: role.normalizationAnchorGroupIds.slice(),
      evidence: role.evidence.slice(0, maxEvidence),
    }))
}

export const formatStructuralRoleDiagnostics = (
  analysis: HandwritingAnalysis,
  options: StructuralRoleDiagnosticsOptions = {},
) => {
  const diagnostics = collectStructuralRoleDiagnostics(analysis, options)

  return diagnostics
    .map((entry) => {
      const header = [
        `group=${entry.groupId}`,
        `role=${entry.role}`,
        `parent=${entry.parentGroupId || 'none'}`,
        `associationContext=${entry.associationContextId || 'none'}`,
        `hostedContext=${entry.hostedContextId || 'none'}`,
        `hostedKind=${entry.hostedContextKind || 'none'}`,
        `normalizationAnchors=${entry.normalizationAnchorGroupIds.join(',') || 'none'}`,
      ].join(' | ')

      return [header, ...entry.evidence.map((evidence, index) => `${index + 1}. ${evidence}`)].join('\n')
    })
    .join('\n\n')
}

export const collectHostProtectionDiagnostics = (
  analysis: HandwritingAnalysis,
  options: HostProtectionDiagnosticsOptions = {},
) => {
  const maxEvidence = options.maxEvidence ?? DEFAULT_MAX_ROLE_EVIDENCE
  const topFamilyByGroupId = new Map(
    collectBrickFamilyScoreDiagnostics(analysis, { topK: 1 }).map((entry) => [entry.groupId, entry.topFamilies[0] || null]),
  )

  const roles: HostProtectionRoleDiagnosticsEntry[] = analysis.roles
    .filter((role) => {
      const topFamily = topFamilyByGroupId.get(role.groupId)?.family || null
      const parentTopFamily = role.parentGroupId ? topFamilyByGroupId.get(role.parentGroupId)?.family || null : null
      const specialRole = role.role === 'fractionBar'
        || role.role === 'provisionalFractionBar'
        || role.role === 'radical'
        || role.role === 'enclosureOpen'
        || role.role === 'enclosureClose'
      const hostedSpecialContext = role.hostedContextKind === 'numerator'
        || role.hostedContextKind === 'denominator'
        || role.hostedContextKind === 'radicand'
        || role.hostedContextKind === 'radicalIndex'
      return specialRole
        || HOST_PROTECTION_FAMILIES.has(topFamily || 'unsupportedBrick')
        || HOST_PROTECTION_FAMILIES.has(parentTopFamily || 'unsupportedBrick')
        || isHostProtectionContextId(role.associationContextId)
        || hostedSpecialContext
        || (role.recognizedSymbol?.category === 'operator')
        || role.evidence.some(isHostProtectionEvidence)
    })
    .sort((left, right) => left.depth - right.depth || left.groupId.localeCompare(right.groupId))
    .map((role) => ({
      groupId: role.groupId,
      role: role.role,
      topFamily: topFamilyByGroupId.get(role.groupId)?.family || null,
      topFamilyScore: topFamilyByGroupId.get(role.groupId)?.score ?? null,
      parentGroupId: role.parentGroupId || null,
      parentTopFamily: role.parentGroupId ? topFamilyByGroupId.get(role.parentGroupId)?.family || null : null,
      associationContextId: role.associationContextId || null,
      hostedContextKind: role.hostedContextKind || null,
      evidence: role.evidence.filter(isHostProtectionEvidence).slice(0, maxEvidence),
    }))

  const relevantGroupIds = new Set(roles.map((role) => role.groupId))
  const ambiguities = analysis.ambiguities.filter((ambiguity) => (
    ambiguity.reason === 'fraction-wide-script-vs-baseline'
    || ambiguity.reason === 'radical-wide-script-vs-baseline'
    || ambiguity.reason === 'enclosure-wide-script-vs-baseline'
    || ambiguity.reason === 'fraction-membership'
    || relevantGroupIds.has(ambiguity.groupId)
  ))
  const flags = analysis.flags.filter((flag) => flag.groupIds.some((groupId) => relevantGroupIds.has(groupId)))

  return { roles, ambiguities, flags }
}

export const formatHostProtectionDiagnostics = (
  analysis: HandwritingAnalysis,
  options: HostProtectionDiagnosticsOptions = {},
) => {
  const diagnostics = collectHostProtectionDiagnostics(analysis, options)

  const roleSection = diagnostics.roles.length
    ? diagnostics.roles.map((entry) => {
      const header = [
        `group=${entry.groupId}`,
        `role=${entry.role}`,
        `topFamily=${entry.topFamily || 'none'}`,
        `topFamilyScore=${entry.topFamilyScore === null ? 'n/a' : entry.topFamilyScore.toFixed(3)}`,
        `parent=${entry.parentGroupId || 'none'}`,
        `parentTopFamily=${entry.parentTopFamily || 'none'}`,
        `associationContext=${entry.associationContextId || 'none'}`,
        `hostedKind=${entry.hostedContextKind || 'none'}`,
      ].join(' | ')
      return [header, ...entry.evidence.map((evidence, index) => `${index + 1}. ${evidence}`)].join('\n')
    }).join('\n\n')
    : 'none'

  const ambiguitySection = diagnostics.ambiguities.length
    ? diagnostics.ambiguities.map((ambiguity) => (
      `group=${ambiguity.groupId} | reason=${ambiguity.reason} | chosen=${ambiguity.chosenRole} | candidates=${ambiguity.candidates.map((candidate) => `${candidate.role}:${candidate.parentGroupId || 'root'}:${candidate.score.toFixed(3)}`).join(', ')}`
    )).join('\n')
    : 'none'

  const flagSection = diagnostics.flags.length
    ? diagnostics.flags.map((flag) => `kind=${flag.kind} | groups=${flag.groupIds.join(',')} | message=${flag.message}`).join('\n')
    : 'none'

  return [`[roles]`, roleSection, `[ambiguities]`, ambiguitySection, `[flags]`, flagSection].join('\n\n')
}