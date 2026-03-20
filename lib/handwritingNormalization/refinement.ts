import { buildConcreteLegoFieldLayer } from './fieldLayout'
import { buildLayoutGraph } from './graph'
import { groupInkStrokes } from './grouping'
import { clamp } from './geometry'
import { getTopBrickHypothesisByGroupId, inferLegoBrickHypotheses, inferLegoBrickOccupancies } from './legoModel'
import { normalizeInkLayout } from './normalize'
import { buildExpressionParseForest } from './parser'
import { inferStructuralRoles } from './roles'
import type {
  HandwritingAnalysis,
  HandwritingAnalysisOptions,
  HandwritingIncrementalGroupState,
  HandwritingIncrementalState,
  HandwritingIncrementalWarmStartSummary,
  HandwritingRefinementPass,
  InkBounds,
  InkStroke,
  LegoBrickFamilyKind,
  LegoBrickHypothesis,
  StrokeGroup,
  StructuralRole,
} from './types'

const MAX_GLOBAL_REFINEMENT_ITERATIONS = 6
const MIN_INCREMENTAL_MATCH_SCORE = 0.4

type AnalysisPass = Omit<HandwritingAnalysis, 'refinement'>
type WarmStartMatch = {
  currentGroupId: string
  priorGroupId: string
  topFamily: LegoBrickFamilyKind
  topFamilyScore: number
  score: number
}

const runAnalysisPass = (groups: StrokeGroup[], brickHypotheses: LegoBrickHypothesis[]): AnalysisPass => {
  const edges = buildLayoutGraph(groups, brickHypotheses)
  const { roles, ambiguities, flags, subexpressions, enclosures, contexts } = inferStructuralRoles(groups, edges, brickHypotheses)
  const brickOccupancies = inferLegoBrickOccupancies(brickHypotheses, roles, contexts, edges)
  const { fieldInstances, fieldIntersections, fieldClaims } = buildConcreteLegoFieldLayer(groups, brickHypotheses)
  const { parseNodes, parseRoots } = buildExpressionParseForest(groups, roles, contexts, enclosures, ambiguities, brickOccupancies)
  const normalization = normalizeInkLayout(groups, roles, contexts)

  return {
    groups,
    edges,
    brickHypotheses,
    brickOccupancies,
    fieldInstances,
    fieldIntersections,
    fieldClaims,
    roles,
    ambiguities,
    flags,
    subexpressions,
    enclosures,
    contexts,
    parseNodes,
    parseRoots,
    normalization,
  }
}

const addAdjustment = (
  adjustmentMap: Map<string, Map<LegoBrickFamilyKind, number>>,
  groupId: string,
  family: LegoBrickFamilyKind,
  delta: number,
) => {
  const familyMap = adjustmentMap.get(groupId) || new Map<LegoBrickFamilyKind, number>()
  familyMap.set(family, (familyMap.get(family) || 0) + delta)
  adjustmentMap.set(groupId, familyMap)
}

const buildRoleMap = (roles: StructuralRole[]) => new Map(roles.map((role) => [role.groupId, role]))

const roleEvidenceIncludes = (role: StructuralRole, needle: string) => role.evidence.some((entry) => entry.includes(needle))

const getInlineBaselineNeighborSupport = (
  role: StructuralRole,
  roleMap: Map<string, StructuralRole>,
  groupMap: Map<string, StrokeGroup>,
) => {
  const group = groupMap.get(role.groupId)
  if (!group) return 0

  const scoreNeighbor = (candidate: StrokeGroup) => {
    const verticalAlignment = clamp(
      1 - Math.abs(candidate.bounds.centerY - group.bounds.centerY) / Math.max(24, Math.max(candidate.bounds.height, group.bounds.height) * 0.6),
      0,
      1,
    )
    const horizontalGap = candidate.bounds.centerX < group.bounds.centerX
      ? Math.max(0, group.bounds.left - candidate.bounds.right)
      : Math.max(0, candidate.bounds.left - group.bounds.right)
    const gapCloseness = clamp(1 - horizontalGap / Math.max(36, group.bounds.width * 0.7), 0, 1)
    return verticalAlignment * 0.58 + gapCloseness * 0.42
  }

  const candidates = analysisCandidateRoles(roleMap, group.id)
    .map((candidateRole) => groupMap.get(candidateRole.groupId) || null)
    .filter(Boolean) as StrokeGroup[]

  const leftNeighbor = candidates
    .filter((candidate) => candidate.bounds.centerX < group.bounds.centerX)
    .map((candidate) => ({ candidate, score: scoreNeighbor(candidate) }))
    .sort((left, right) => right.score - left.score || right.candidate.bounds.centerX - left.candidate.bounds.centerX)[0] || null

  const rightNeighbor = candidates
    .filter((candidate) => candidate.bounds.centerX > group.bounds.centerX)
    .map((candidate) => ({ candidate, score: scoreNeighbor(candidate) }))
    .sort((left, right) => right.score - left.score || left.candidate.bounds.centerX - right.candidate.bounds.centerX)[0] || null

  if (!leftNeighbor && !rightNeighbor) return 0
  if (leftNeighbor && rightNeighbor) {
    return clamp(leftNeighbor.score * 0.5 + rightNeighbor.score * 0.5, 0, 1)
  }
  return (leftNeighbor?.score || rightNeighbor?.score || 0) * 0.72
}

const analysisCandidateRoles = (roleMap: Map<string, StructuralRole>, excludedGroupId: string) => {
  return Array.from(roleMap.values()).filter((candidateRole) => {
    if (candidateRole.groupId === excludedGroupId) return false
    if (candidateRole.parentGroupId) return false
    return candidateRole.role === 'baseline' || candidateRole.role === 'numerator' || candidateRole.role === 'denominator'
  })
}

const isReleasedFractionLikeBaseline = (role: StructuralRole) => {
  if (role.role !== 'baseline') return false
  return roleEvidenceIncludes(role, 'pairing=fractionBar-vs-baseline')
    || roleEvidenceIncludes(role, 'pairing=provisionalFractionBar-vs-baseline')
    || roleEvidenceIncludes(role, 'unvindicated fraction candidate defaulted to minus-like baseline operator')
}

const deriveBrickFamilyAdjustments = (analysis: AnalysisPass) => {
  const adjustmentMap = new Map<string, Map<LegoBrickFamilyKind, number>>()
  const roleMap = buildRoleMap(analysis.roles)
  const groupMap = new Map(analysis.groups.map((group) => [group.id, group]))
  const childRolesByParentId = new Map<string, StructuralRole[]>()

  for (const role of analysis.roles) {
    if (!role.parentGroupId) continue
    const bucket = childRolesByParentId.get(role.parentGroupId) || []
    bucket.push(role)
    childRolesByParentId.set(role.parentGroupId, bucket)
  }

  for (const role of analysis.roles) {
    const scriptChildren = childRolesByParentId.get(role.groupId) || []
    const inlineNeighborSupport = getInlineBaselineNeighborSupport(role, roleMap, groupMap)
    const releasedFractionLikeBaseline = isReleasedFractionLikeBaseline(role)
    const inlineContextBackedBaseline = roleEvidenceIncludes(role, 'inline sequence fallback')
      || roleEvidenceIncludes(role, 'inline-field-pair=')
      || inlineNeighborSupport >= 0.6
      || releasedFractionLikeBaseline
    const operatorBaseline = role.recognizedSymbol?.category === 'operator' && !scriptChildren.length && inlineContextBackedBaseline
    const minusBaseline = role.recognizedSymbol?.value === '-' && !scriptChildren.length && inlineContextBackedBaseline

    switch (role.role) {
      case 'baseline': {
        addAdjustment(adjustmentMap, role.groupId, 'ordinaryBaselineSymbolBrick', scriptChildren.length ? 0.1 : 0.06)
        if (scriptChildren.length) {
          addAdjustment(adjustmentMap, role.groupId, 'operatorBrick', -0.08)
          addAdjustment(adjustmentMap, role.groupId, 'radicalBrick', -0.1)
          addAdjustment(adjustmentMap, role.groupId, 'fractionBarBrick', -0.12)
        }
        if (operatorBaseline) {
          addAdjustment(adjustmentMap, role.groupId, 'ordinaryBaselineSymbolBrick', 0.08)
          addAdjustment(adjustmentMap, role.groupId, 'operatorBrick', 0.14)
          addAdjustment(adjustmentMap, role.groupId, 'fractionBarBrick', -0.18)
        }
        if (minusBaseline) {
          addAdjustment(adjustmentMap, role.groupId, 'ordinaryBaselineSymbolBrick', 0.06)
          addAdjustment(adjustmentMap, role.groupId, 'fractionBarBrick', -0.1)
        }
        if (releasedFractionLikeBaseline) {
          addAdjustment(adjustmentMap, role.groupId, 'ordinaryBaselineSymbolBrick', 0.16)
          addAdjustment(adjustmentMap, role.groupId, 'operatorBrick', 0.08)
          addAdjustment(adjustmentMap, role.groupId, 'fractionBarBrick', -0.24)
        }
        break
      }
      case 'superscript':
      case 'subscript':
      case 'numerator':
      case 'denominator': {
        addAdjustment(adjustmentMap, role.groupId, 'ordinaryBaselineSymbolBrick', 0.05)
        addAdjustment(adjustmentMap, role.groupId, 'fractionBarBrick', -0.1)
        addAdjustment(adjustmentMap, role.groupId, 'radicalBrick', -0.08)
        addAdjustment(adjustmentMap, role.groupId, 'operatorBrick', -0.05)
        break
      }
      case 'fractionBar': {
        addAdjustment(adjustmentMap, role.groupId, 'fractionBarBrick', 0.22)
        addAdjustment(adjustmentMap, role.groupId, 'ordinaryBaselineSymbolBrick', -0.12)
        addAdjustment(adjustmentMap, role.groupId, 'operatorBrick', -0.08)
        break
      }
      case 'provisionalFractionBar': {
        addAdjustment(adjustmentMap, role.groupId, 'fractionBarBrick', 0.12)
        addAdjustment(adjustmentMap, role.groupId, 'ordinaryBaselineSymbolBrick', -0.05)
        break
      }
      case 'radical': {
        addAdjustment(adjustmentMap, role.groupId, 'radicalBrick', 0.22)
        addAdjustment(adjustmentMap, role.groupId, 'ordinaryBaselineSymbolBrick', -0.1)
        addAdjustment(adjustmentMap, role.groupId, 'operatorBrick', -0.08)
        break
      }
      case 'enclosureOpen':
      case 'enclosureClose': {
        addAdjustment(adjustmentMap, role.groupId, 'enclosureBoundaryBrick', 0.22)
        addAdjustment(adjustmentMap, role.groupId, 'ordinaryBaselineSymbolBrick', -0.08)
        break
      }
      case 'unsupportedSymbol': {
        addAdjustment(adjustmentMap, role.groupId, 'unsupportedBrick', 0.04)
        break
      }
      default:
        break
    }
  }

  for (const occupancy of analysis.brickOccupancies) {
    const hostRole = occupancy.hostGroupId ? roleMap.get(occupancy.hostGroupId) || null : null

    if (occupancy.hostGroupId) {
      switch (occupancy.field) {
        case 'upperRightScript':
        case 'lowerRightScript':
          addAdjustment(adjustmentMap, occupancy.hostGroupId, 'ordinaryBaselineSymbolBrick', 0.04)
          addAdjustment(adjustmentMap, occupancy.hostGroupId, 'operatorBrick', -0.04)
          break
        case 'over':
        case 'under':
          addAdjustment(adjustmentMap, occupancy.hostGroupId, 'fractionBarBrick', 0.1)
          addAdjustment(adjustmentMap, occupancy.hostGroupId, 'ordinaryBaselineSymbolBrick', -0.04)
          break
        case 'interior':
          if (hostRole?.role === 'radical') {
            addAdjustment(adjustmentMap, occupancy.hostGroupId, 'radicalBrick', 0.1)
          } else {
            addAdjustment(adjustmentMap, occupancy.hostGroupId, 'enclosureBoundaryBrick', 0.1)
          }
          break
        case 'leftInline':
        case 'rightInline':
          addAdjustment(adjustmentMap, occupancy.hostGroupId, 'ordinaryBaselineSymbolBrick', 0.03)
          addAdjustment(adjustmentMap, occupancy.hostGroupId, 'operatorBrick', 0.04)
          break
        default:
          break
      }
    }

    if (occupancy.field === 'upperRightScript' || occupancy.field === 'lowerRightScript') {
      addAdjustment(adjustmentMap, occupancy.groupId, 'ordinaryBaselineSymbolBrick', 0.03)
      addAdjustment(adjustmentMap, occupancy.groupId, 'fractionBarBrick', -0.08)
    }
  }

  for (const ambiguity of analysis.ambiguities) {
    if (ambiguity.chosenRole === 'superscript' || ambiguity.chosenRole === 'subscript') {
      addAdjustment(adjustmentMap, ambiguity.groupId, 'ordinaryBaselineSymbolBrick', 0.02)
      addAdjustment(adjustmentMap, ambiguity.groupId, 'fractionBarBrick', -0.05)
    }
    if (ambiguity.reason === 'fraction-membership') {
      addAdjustment(adjustmentMap, ambiguity.groupId, 'ordinaryBaselineSymbolBrick', 0.02)
    }
  }

  for (const node of analysis.parseNodes) {
    if (!node.operatorGroupId) continue
    if (node.kind === 'fractionExpression') {
      addAdjustment(adjustmentMap, node.operatorGroupId, 'fractionBarBrick', 0.08)
    }
    if (node.kind === 'radicalExpression') {
      addAdjustment(adjustmentMap, node.operatorGroupId, 'radicalBrick', 0.08)
    }
  }

  return adjustmentMap
}

const getBrickFamilyScoreCeiling = (family: LegoBrickFamilyKind) => {
  switch (family) {
    case 'ordinaryBaselineSymbolBrick':
      return 0.94
    case 'unsupportedBrick':
      return 0.4
    default:
      return 0.98
  }
}

const applyGlobalMutualReinforcement = (
  seedBrickHypotheses: LegoBrickHypothesis[],
  analysis: AnalysisPass,
  iteration: number,
) => {
  const adjustmentMap = deriveBrickFamilyAdjustments(analysis)
  const previousTopByGroupId = getTopBrickHypothesisByGroupId(analysis.brickHypotheses)

  return seedBrickHypotheses.map((hypothesis) => {
    const familyAdjustment = adjustmentMap.get(hypothesis.groupId)?.get(hypothesis.family) || 0
    const persistenceBoost = previousTopByGroupId.get(hypothesis.groupId)?.family === hypothesis.family ? 0.02 : 0
    const nextScore = clamp(hypothesis.score + familyAdjustment + persistenceBoost, 0.01, getBrickFamilyScoreCeiling(hypothesis.family))
    const refinementEvidence = familyAdjustment !== 0 || persistenceBoost !== 0
      ? [`global-refinement-pass=${iteration}`, `global-family-adjustment=${familyAdjustment.toFixed(3)}`, `persistence-boost=${persistenceBoost.toFixed(3)}`]
      : []

    return {
      ...hypothesis,
      score: nextScore,
      evidence: refinementEvidence.length ? [...hypothesis.evidence, ...refinementEvidence] : hypothesis.evidence,
    }
  })
}

const getAnalysisSignature = (analysis: AnalysisPass) => {
  const topFamilies = Array.from(getTopBrickHypothesisByGroupId(analysis.brickHypotheses).values())
    .sort((left, right) => left.groupId.localeCompare(right.groupId))
    .map((hypothesis) => `${hypothesis.groupId}:${hypothesis.family}`)
    .join('|')

  const roles = [...analysis.roles]
    .sort((left, right) => left.groupId.localeCompare(right.groupId))
    .map((role) => `${role.groupId}:${role.role}:${role.parentGroupId || 'none'}:${role.associationContextId || 'root'}`)
    .join('|')

  const contexts = [...analysis.contexts]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((context) => `${context.kind}:${context.semanticRootGroupId || 'none'}:${context.anchorGroupIds.join(',')}`)
    .join('|')

  const parseRoots = [...analysis.parseRoots]
    .sort((left, right) => left.contextId.localeCompare(right.contextId))
    .map((root) => `${root.contextId}:${root.rootNodeId || 'none'}:${root.nodeIds.join(',')}`)
    .join('|')

  const occupancies = [...analysis.brickOccupancies]
    .sort((left, right) => `${left.groupId}:${left.field}`.localeCompare(`${right.groupId}:${right.field}`))
    .map((occupancy) => `${occupancy.groupId}:${occupancy.field}:${occupancy.hostGroupId || 'none'}`)
    .join('|')

  return [topFamilies, roles, contexts, parseRoots, occupancies].join('||')
}

const getTopBrickFamilyStates = (analysis: HandwritingAnalysis): HandwritingIncrementalGroupState[] => {
  const topByGroupId = getTopBrickHypothesisByGroupId(analysis.brickHypotheses)

  return analysis.groups.map((group) => {
    const topHypothesis = topByGroupId.get(group.id) || null
    return {
      groupId: group.id,
      strokeIds: [...group.strokeIds],
      bounds: group.bounds,
      topFamily: topHypothesis?.family || null,
      topFamilyScore: topHypothesis?.score || 0,
    }
  })
}

const getStrokeOverlapScore = (currentGroup: StrokeGroup, priorGroup: HandwritingIncrementalGroupState) => {
  const currentStrokeIds = new Set(currentGroup.strokeIds)
  let sharedCount = 0

  for (const strokeId of priorGroup.strokeIds) {
    if (currentStrokeIds.has(strokeId)) sharedCount += 1
  }

  if (!sharedCount) return 0
  return sharedCount / Math.max(currentGroup.strokeIds.length, priorGroup.strokeIds.length)
}

const getBoundsSimilarityScore = (left: InkBounds, right: InkBounds) => {
  const widthDelta = Math.abs(left.width - right.width) / Math.max(left.width, right.width, 1)
  const heightDelta = Math.abs(left.height - right.height) / Math.max(left.height, right.height, 1)
  const centerDistance = Math.hypot(left.centerX - right.centerX, left.centerY - right.centerY)
  const sizeScale = Math.max(left.width, left.height, right.width, right.height, 1)
  const centerScore = clamp(1 - centerDistance / Math.max(sizeScale * 1.8, 1), 0, 1)
  const shapeScore = clamp(1 - (widthDelta + heightDelta) / 2, 0, 1)

  return centerScore * 0.6 + shapeScore * 0.4
}

const getWarmStartMatchScore = (currentGroup: StrokeGroup, priorGroup: HandwritingIncrementalGroupState) => {
  const strokeOverlapScore = getStrokeOverlapScore(currentGroup, priorGroup)
  if (strokeOverlapScore > 0) return strokeOverlapScore * 0.8 + getBoundsSimilarityScore(currentGroup.bounds, priorGroup.bounds) * 0.2
  return getBoundsSimilarityScore(currentGroup.bounds, priorGroup.bounds) * 0.35
}

const collectWarmStartMatches = (groups: StrokeGroup[], incrementalState: HandwritingIncrementalState): WarmStartMatch[] => {
  const matches: WarmStartMatch[] = []

  for (const group of groups) {
    let bestMatch: WarmStartMatch | null = null

    for (const priorGroup of incrementalState.groups) {
      if (!priorGroup.topFamily) continue
      const score = getWarmStartMatchScore(group, priorGroup)
      if (score < MIN_INCREMENTAL_MATCH_SCORE) continue
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          currentGroupId: group.id,
          priorGroupId: priorGroup.groupId,
          topFamily: priorGroup.topFamily,
          topFamilyScore: priorGroup.topFamilyScore,
          score,
        }
      }
    }

    if (bestMatch) matches.push(bestMatch)
  }

  return matches
}

const applyIncrementalWarmStart = (
  seedBrickHypotheses: LegoBrickHypothesis[],
  groups: StrokeGroup[],
  incrementalState: HandwritingIncrementalState | null | undefined,
): { hypotheses: LegoBrickHypothesis[]; warmStart: HandwritingIncrementalWarmStartSummary } => {
  if (!incrementalState) {
    return {
      hypotheses: seedBrickHypotheses,
      warmStart: { enabled: false, matchedGroups: 0, reusedFamilySeeds: 0, averageMatchScore: 0 },
    }
  }

  const matches = collectWarmStartMatches(groups, incrementalState)
  if (!matches.length) {
    return {
      hypotheses: seedBrickHypotheses,
      warmStart: { enabled: true, matchedGroups: 0, reusedFamilySeeds: 0, averageMatchScore: 0 },
    }
  }

  const matchByGroupId = new Map(matches.map((match) => [match.currentGroupId, match]))
  let reusedFamilySeeds = 0

  const hypotheses = seedBrickHypotheses.map((hypothesis) => {
    const match = matchByGroupId.get(hypothesis.groupId)
    if (!match) return hypothesis

    const familyBoost = hypothesis.family === match.topFamily ? clamp(0.18 * match.score * Math.max(match.topFamilyScore, 0.5), 0.04, 0.2) : 0
    const stabilityBoost = match.score >= 0.75 && hypothesis.family === 'ordinaryBaselineSymbolBrick' ? 0.03 : 0
    if (familyBoost > 0) reusedFamilySeeds += 1
    const nextScore = clamp(hypothesis.score + familyBoost + stabilityBoost, 0.01, 1)
    const evidence = familyBoost || stabilityBoost
      ? [
          ...hypothesis.evidence,
          `incremental-warm-start=${match.priorGroupId}`,
          `incremental-match-score=${match.score.toFixed(3)}`,
          `incremental-family-boost=${familyBoost.toFixed(3)}`,
          `incremental-stability-boost=${stabilityBoost.toFixed(3)}`,
        ]
      : hypothesis.evidence

    return {
      ...hypothesis,
      score: nextScore,
      evidence,
    }
  })

  const averageMatchScore = matches.reduce((sum, match) => sum + match.score, 0) / matches.length
  return {
    hypotheses,
    warmStart: {
      enabled: true,
      matchedGroups: matches.length,
      reusedFamilySeeds,
      averageMatchScore,
    },
  }
}

export const createHandwritingIncrementalState = (analysis: HandwritingAnalysis): HandwritingIncrementalState => ({
  analysis,
  groups: getTopBrickFamilyStates(analysis),
})

export const analyzeHandwrittenExpressionIteratively = (
  strokes: InkStroke[],
  options?: HandwritingAnalysisOptions,
): HandwritingAnalysis => {
  const groups = groupInkStrokes(strokes)
  const initialBrickHypotheses = inferLegoBrickHypotheses(groups)
  const { hypotheses: seedBrickHypotheses, warmStart } = applyIncrementalWarmStart(initialBrickHypotheses, groups, options?.incrementalState)

  let currentPass = runAnalysisPass(groups, seedBrickHypotheses)
  let previousSignature = getAnalysisSignature(currentPass)
  const seenSignatures = new Set([previousSignature])
  const refinementPasses: HandwritingRefinementPass[] = [{ iteration: 0, signature: previousSignature, changed: true }]

  for (let iteration = 1; iteration <= MAX_GLOBAL_REFINEMENT_ITERATIONS; iteration += 1) {
    const refinedHypotheses = applyGlobalMutualReinforcement(seedBrickHypotheses, currentPass, iteration)
    const nextPass = runAnalysisPass(groups, refinedHypotheses)
    const nextSignature = getAnalysisSignature(nextPass)
    const changed = nextSignature !== previousSignature

    refinementPasses.push({ iteration, signature: nextSignature, changed })

    if (!changed) {
      return {
        ...nextPass,
        refinement: {
          iterations: iteration + 1,
          converged: true,
          maxIterations: MAX_GLOBAL_REFINEMENT_ITERATIONS,
          passes: refinementPasses,
          warmStart,
        },
      }
    }

    if (seenSignatures.has(nextSignature)) {
      return {
        ...nextPass,
        refinement: {
          iterations: iteration + 1,
          converged: false,
          maxIterations: MAX_GLOBAL_REFINEMENT_ITERATIONS,
          passes: refinementPasses,
          warmStart,
        },
      }
    }

    seenSignatures.add(nextSignature)
    currentPass = nextPass
    previousSignature = nextSignature
  }

  return {
    ...currentPass,
    refinement: {
      iterations: refinementPasses.length,
      converged: false,
      maxIterations: MAX_GLOBAL_REFINEMENT_ITERATIONS,
      passes: refinementPasses,
      warmStart,
    },
  }
}