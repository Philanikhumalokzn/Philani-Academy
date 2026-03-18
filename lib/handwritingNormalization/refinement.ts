import { buildLayoutGraph } from './graph'
import { groupInkStrokes } from './grouping'
import { clamp } from './geometry'
import { getTopBrickHypothesisByGroupId, inferLegoBrickHypotheses, inferLegoBrickOccupancies } from './legoModel'
import { normalizeInkLayout } from './normalize'
import { buildExpressionParseForest } from './parser'
import { inferStructuralRoles } from './roles'
import type { HandwritingAnalysis, HandwritingRefinementPass, InkStroke, LegoBrickFamilyKind, LegoBrickHypothesis, StrokeGroup, StructuralRole } from './types'

const MAX_GLOBAL_REFINEMENT_ITERATIONS = 6

type AnalysisPass = Omit<HandwritingAnalysis, 'refinement'>

const runAnalysisPass = (groups: StrokeGroup[], brickHypotheses: LegoBrickHypothesis[]): AnalysisPass => {
  const edges = buildLayoutGraph(groups, brickHypotheses)
  const { roles, ambiguities, flags, subexpressions, enclosures, contexts } = inferStructuralRoles(groups, edges, brickHypotheses)
  const brickOccupancies = inferLegoBrickOccupancies(brickHypotheses, roles, contexts, edges)
  const { parseNodes, parseRoots } = buildExpressionParseForest(groups, roles, contexts, enclosures, ambiguities, brickOccupancies)
  const normalization = normalizeInkLayout(groups, roles, contexts)

  return {
    groups,
    edges,
    brickHypotheses,
    brickOccupancies,
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

const deriveBrickFamilyAdjustments = (analysis: AnalysisPass) => {
  const adjustmentMap = new Map<string, Map<LegoBrickFamilyKind, number>>()
  const roleMap = buildRoleMap(analysis.roles)
  const childRolesByParentId = new Map<string, StructuralRole[]>()

  for (const role of analysis.roles) {
    if (!role.parentGroupId) continue
    const bucket = childRolesByParentId.get(role.parentGroupId) || []
    bucket.push(role)
    childRolesByParentId.set(role.parentGroupId, bucket)
  }

  for (const role of analysis.roles) {
    const scriptChildren = childRolesByParentId.get(role.groupId) || []

    switch (role.role) {
      case 'baseline': {
        addAdjustment(adjustmentMap, role.groupId, 'ordinaryBaselineSymbolBrick', scriptChildren.length ? 0.18 : 0.12)
        if (scriptChildren.length) {
          addAdjustment(adjustmentMap, role.groupId, 'operatorBrick', -0.08)
          addAdjustment(adjustmentMap, role.groupId, 'radicalBrick', -0.1)
          addAdjustment(adjustmentMap, role.groupId, 'fractionBarBrick', -0.12)
        }
        if (role.recognizedSymbol?.category === 'operator' && !scriptChildren.length) {
          addAdjustment(adjustmentMap, role.groupId, 'operatorBrick', 0.06)
        }
        break
      }
      case 'superscript':
      case 'subscript':
      case 'numerator':
      case 'denominator': {
        addAdjustment(adjustmentMap, role.groupId, 'ordinaryBaselineSymbolBrick', 0.1)
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
          addAdjustment(adjustmentMap, occupancy.hostGroupId, 'ordinaryBaselineSymbolBrick', 0.08)
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
      addAdjustment(adjustmentMap, occupancy.groupId, 'ordinaryBaselineSymbolBrick', 0.06)
      addAdjustment(adjustmentMap, occupancy.groupId, 'fractionBarBrick', -0.08)
    }
  }

  for (const ambiguity of analysis.ambiguities) {
    if (ambiguity.chosenRole === 'superscript' || ambiguity.chosenRole === 'subscript') {
      addAdjustment(adjustmentMap, ambiguity.groupId, 'ordinaryBaselineSymbolBrick', 0.05)
      addAdjustment(adjustmentMap, ambiguity.groupId, 'fractionBarBrick', -0.05)
    }
    if (ambiguity.reason === 'fraction-membership') {
      addAdjustment(adjustmentMap, ambiguity.groupId, 'ordinaryBaselineSymbolBrick', 0.04)
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
    const nextScore = clamp(hypothesis.score + familyAdjustment + persistenceBoost, 0.01, 1)
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

export const analyzeHandwrittenExpressionIteratively = (strokes: InkStroke[]): HandwritingAnalysis => {
  const groups = groupInkStrokes(strokes)
  const seedBrickHypotheses = inferLegoBrickHypotheses(groups)

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
    },
  }
}