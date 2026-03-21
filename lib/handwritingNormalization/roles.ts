import { buildConcreteLegoFieldLayer } from './fieldLayout'
import { clamp } from './geometry'
import { buildBrickHypothesesByGroupId, getBlendedInlineFieldWeight, getTopBrickHypothesisByGroupId } from './legoModel'
import { getRoleDescriptor, getRoleLocalityBias, roleAllowsChildRole, roleAllowsOperandRole, roleCanOwnScripts, roleRequiresOperandReference, roleUsesChildOperands, roleUsesParentOperand } from './roleTaxonomy'
import { annotateRolesWithRecognizedSymbols } from './symbolRecognition'
import type { EnclosureStructure, ExpressionContext, LayoutEdge, LegoBrickHypothesis, LegoFieldClaim, LocalSubexpression, StrokeGroup, StructuralAmbiguity, StructuralFlag, StructuralRole, StructuralRoleCandidate, StructuralRoleKind } from './types'

const FRACTION_BAR_MAX_HEIGHT = 18
const FRACTION_BAR_MIN_WIDTH = 70
const LEGO_SCRIPT_HOST_MIN_WEIGHT = 0.44
const LEGO_SEQUENCE_CONTEXT_MIN_INLINE_SCORE = 0.42
const COMPETING_INTERPRETATION_MIN_CLAIM_SCORE = 0.26
const COMPETING_INTERPRETATION_TRANSFER_WEIGHT = 0.16
const COMPETING_INTERPRETATION_MAX_RIVAL_MARGIN = 0.22
const SCRIPT_INLINE_SUPPRESSION_MIN_INLINE_SCORE = 0.34
const SCRIPT_INLINE_SUPPRESSION_MIN_HOSTED_ADVANTAGE = 0.08
const SCRIPT_INLINE_SUPPRESSION_MIN_SCORE_ADVANTAGE = 0.06

const getFractionBarShapeScore = (group: StrokeGroup) => {
  const heightScore = clamp(1 - Math.max(group.bounds.height - FRACTION_BAR_MAX_HEIGHT, 0) / FRACTION_BAR_MAX_HEIGHT, 0, 1)
  const widthScore = clamp((group.bounds.width - FRACTION_BAR_MIN_WIDTH) / Math.max(18, FRACTION_BAR_MIN_WIDTH), 0, 1)
  const flatnessScore = clamp((group.aspectRatio - 3.4) / 3.4, 0, 1)
  return heightScore * 0.34 + widthScore * 0.24 + flatnessScore * 0.42
}

const isFractionBarLikeGroup = (group: StrokeGroup) => {
  return group.bounds.width >= FRACTION_BAR_MIN_WIDTH && getFractionBarShapeScore(group) >= 0.58
}

const bestIncoming = (edges: LayoutEdge[], groupId: string, kind: LayoutEdge['kind']) => {
  return edges
    .filter((edge) => edge.toId === groupId && edge.kind === kind)
    .sort((left, right) => right.score - left.score)[0] || null
}

const bestOutgoing = (edges: LayoutEdge[], groupId: string, kind: LayoutEdge['kind']) => {
  return edges
    .filter((edge) => edge.fromId === groupId && edge.kind === kind)
    .sort((left, right) => right.score - left.score)[0] || null
}

const incomingByKind = (edges: LayoutEdge[], groupId: string, kind: LayoutEdge['kind']) => {
  return edges
    .filter((edge) => edge.toId === groupId && edge.kind === kind)
    .sort((left, right) => right.score - left.score)
}

const getScriptFieldKind = (role: 'superscript' | 'subscript') => {
  return role === 'superscript' ? 'upperRightScript' : 'lowerRightScript'
}

const isDisallowedScriptChildFamily = (
  family: LegoBrickHypothesis['family'] | null | undefined,
  lineLikeChild: boolean,
) => {
  return family === 'enclosureBoundaryBrick' || (family === 'operatorBrick' && !lineLikeChild)
}

const getBrickFieldWeight = (
  topBrickHypothesisByGroupId: Map<string, LegoBrickHypothesis>,
  groupId: string | null | undefined,
  fieldKind: 'upperRightScript' | 'lowerRightScript',
) => {
  if (!groupId) return null
  const topHypothesis = topBrickHypothesisByGroupId.get(groupId)
  if (!topHypothesis) return null
  return topHypothesis.fields.find((field) => field.kind === fieldKind)?.weight ?? 0
}

const hostSupportsScriptField = (
  topBrickHypothesisByGroupId: Map<string, LegoBrickHypothesis>,
  parentGroupId: string | null | undefined,
  role: 'superscript' | 'subscript',
) => {
  const fieldWeight = getBrickFieldWeight(topBrickHypothesisByGroupId, parentGroupId, getScriptFieldKind(role))
  if (fieldWeight === null) {
    return { supported: true, fieldWeight: null }
  }

  const topHypothesis = parentGroupId ? topBrickHypothesisByGroupId.get(parentGroupId) || null : null
  if (topHypothesis?.family === 'operatorBrick') {
    return {
      supported: false,
      fieldWeight,
    }
  }
  const minimumWeight = topHypothesis?.family === 'enclosureBoundaryBrick' ? 0.34 : LEGO_SCRIPT_HOST_MIN_WEIGHT

  return {
    supported: fieldWeight >= minimumWeight,
    fieldWeight,
  }
}

const getScriptBarrierFamilyWeight = (family: LegoBrickHypothesis['family']) => {
  switch (family) {
    case 'fractionBarBrick':
    case 'enclosureBoundaryBrick':
    case 'operatorBrick':
      return 1
    case 'radicalBrick':
      return 0.94
    case 'ordinaryBaselineSymbolBrick':
      return 0.76
    case 'unsupportedBrick':
    default:
      return 0.36
  }
}

const getDirectScriptHostBarrier = (
  groupMap: Map<string, StrokeGroup>,
  topBrickHypothesisByGroupId: Map<string, LegoBrickHypothesis>,
  parentGroupId: string | null | undefined,
  childGroupId: string | null | undefined,
  ignoredGroupIds: Set<string> = new Set(),
) => {
  if (!parentGroupId || !childGroupId) return null
  const parentGroup = groupMap.get(parentGroupId)
  const childGroup = groupMap.get(childGroupId)
  if (!parentGroup || !childGroup || childGroup.bounds.centerX <= parentGroup.bounds.centerX) return null

  const corridorTop = Math.min(parentGroup.bounds.top, childGroup.bounds.top) - Math.max(10, Math.min(parentGroup.bounds.height, childGroup.bounds.height) * 0.22)
  const corridorBottom = Math.max(parentGroup.bounds.bottom, childGroup.bounds.bottom) + Math.max(10, Math.min(parentGroup.bounds.height, childGroup.bounds.height) * 0.22)
  const midpointX = (parentGroup.bounds.centerX + childGroup.bounds.centerX) / 2
  const halfSpanX = Math.max(1, (childGroup.bounds.centerX - parentGroup.bounds.centerX) / 2)

  const blockers = Array.from(groupMap.values())
    .filter((group) => group.id !== parentGroupId && group.id !== childGroupId)
    .filter((group) => !ignoredGroupIds.has(group.id))
    .filter((group) => group.bounds.centerX > parentGroup.bounds.centerX && group.bounds.centerX < childGroup.bounds.centerX)
    .filter((group) => group.bounds.bottom >= corridorTop && group.bounds.top <= corridorBottom)
    .map((group) => {
      const family = topBrickHypothesisByGroupId.get(group.id)?.family || 'unsupportedBrick'
      const familyWeight = getScriptBarrierFamilyWeight(family)
      const verticalOverlap = clamp(
        (Math.min(group.bounds.bottom, corridorBottom) - Math.max(group.bounds.top, corridorTop)) / Math.max(1, corridorBottom - corridorTop),
        0,
        1,
      )
      const centrality = clamp(1 - Math.abs(group.bounds.centerX - midpointX) / halfSpanX, 0, 1)
      const score = familyWeight * 0.62 + verticalOverlap * 0.2 + centrality * 0.18
      return { groupId: group.id, family, score }
    })
    .sort((left, right) => right.score - left.score)

  return blockers[0]?.score >= 0.58 ? blockers[0] : null
}

const getCrossFractionStructureBarrier = (
  groupMap: Map<string, StrokeGroup>,
  fractionBarrierGroups: StrokeGroup[],
  parentGroupId: string | null | undefined,
  childGroupId: string | null | undefined,
  ignoredGroupIds: Set<string> = new Set(),
) => {
  if (!parentGroupId || !childGroupId) return null
  const parentGroup = groupMap.get(parentGroupId)
  const childGroup = groupMap.get(childGroupId)
  if (!parentGroup || !childGroup) return null

  const barriers = fractionBarrierGroups
    .filter((group) => group.id !== parentGroupId && group.id !== childGroupId)
    .filter((group) => !ignoredGroupIds.has(group.id))
    .map((barrier) => {
      const parentAbove = parentGroup.bounds.bottom <= barrier.bounds.centerY + Math.max(10, barrier.bounds.height * 2.4)
      const parentBelow = parentGroup.bounds.top >= barrier.bounds.centerY - Math.max(10, barrier.bounds.height * 2.4)
      const childAbove = childGroup.bounds.bottom <= barrier.bounds.centerY + Math.max(10, barrier.bounds.height * 2.4)
      const childBelow = childGroup.bounds.top >= barrier.bounds.centerY - Math.max(10, barrier.bounds.height * 2.4)
      const oppositeSides = (parentAbove && childBelow) || (parentBelow && childAbove)
      if (!oppositeSides) return null

      const parentHorizontalOverlap = clamp(
        (Math.min(parentGroup.bounds.right, barrier.bounds.right) - Math.max(parentGroup.bounds.left, barrier.bounds.left)) / Math.max(1, Math.min(parentGroup.bounds.width, barrier.bounds.width)),
        0,
        1,
      )
      const childHorizontalOverlap = clamp(
        (Math.min(childGroup.bounds.right, barrier.bounds.right) - Math.max(childGroup.bounds.left, barrier.bounds.left)) / Math.max(1, Math.min(childGroup.bounds.width, barrier.bounds.width)),
        0,
        1,
      )
      if (parentHorizontalOverlap < 0.18 || childHorizontalOverlap < 0.18) return null

      const spanLeft = Math.min(parentGroup.bounds.left, childGroup.bounds.left)
      const spanRight = Math.max(parentGroup.bounds.right, childGroup.bounds.right)
      const horizontalCoverage = clamp(
        (Math.min(barrier.bounds.right, spanRight + Math.max(14, barrier.bounds.width * 0.08)) - Math.max(barrier.bounds.left, spanLeft - Math.max(14, barrier.bounds.width * 0.08)))
          / Math.max(1, spanRight - spanLeft + Math.max(20, barrier.bounds.width * 0.16)),
        0,
        1,
      )
      const centrality = clamp(
        1 - Math.abs(barrier.bounds.centerX - (parentGroup.bounds.centerX + childGroup.bounds.centerX) / 2)
          / Math.max(28, Math.abs(childGroup.bounds.centerX - parentGroup.bounds.centerX) * 0.7 + barrier.bounds.width * 0.22),
        0,
        1,
      )
      const verticalSeparation = clamp(
        Math.abs(parentGroup.bounds.centerY - childGroup.bounds.centerY) / Math.max(28, barrier.bounds.height * 7.5),
        0,
        1,
      )
      const score = horizontalCoverage * 0.32 + centrality * 0.2 + verticalSeparation * 0.24 + parentHorizontalOverlap * 0.12 + childHorizontalOverlap * 0.12

      return {
        groupId: barrier.id,
        family: 'fractionBarBrick' as const,
        score,
      }
    })
    .filter(Boolean)
    .sort((left, right) => (right?.score || 0) - (left?.score || 0))

  return (barriers[0]?.score || 0) >= 0.54 ? barriers[0] : null
}

const getRadicalIndexFitScore = (radical: StrokeGroup, candidate: StrokeGroup) => {
  const targetX = radical.bounds.left - Math.max(18, radical.bounds.width * 0.34)
  const targetY = radical.bounds.top - Math.max(10, radical.bounds.height * 0.18)
  const horizontalCloseness = clamp(1 - Math.abs(candidate.bounds.centerX - targetX) / Math.max(22, radical.bounds.width * 0.42), 0, 1)
  const verticalCloseness = clamp(1 - Math.abs(candidate.bounds.centerY - targetY) / Math.max(20, radical.bounds.height * 0.34), 0, 1)
  const sizeScore = clamp(1 - Math.max(candidate.bounds.width - radical.bounds.width * 0.42, 0) / Math.max(18, radical.bounds.width * 0.24), 0, 1)
  return horizontalCloseness * 0.42 + verticalCloseness * 0.4 + sizeScore * 0.18
}

const getRadicalInteriorFitScore = (radical: StrokeGroup, candidate: StrokeGroup) => {
  const targetLeft = radical.bounds.left + Math.max(14, radical.bounds.width * 0.22)
  const targetRight = radical.bounds.right + Math.max(18, radical.bounds.width * 0.14)
  const targetTop = radical.bounds.top - Math.max(8, radical.bounds.height * 0.06)
  const targetBottom = radical.bounds.bottom - Math.max(4, radical.bounds.height * 0.12)
  const horizontalOverlap = clamp(Math.min(candidate.bounds.right, targetRight) - Math.max(candidate.bounds.left, targetLeft), 0, candidate.bounds.width) / Math.max(1, candidate.bounds.width)
  const verticalOverlap = clamp(Math.min(candidate.bounds.bottom, targetBottom) - Math.max(candidate.bounds.top, targetTop), 0, candidate.bounds.height) / Math.max(1, candidate.bounds.height)
  const leftProgress = clamp((candidate.bounds.left - (radical.bounds.left + radical.bounds.width * 0.12)) / Math.max(24, radical.bounds.width * 0.5), 0, 1)
  const rightPenalty = clamp(1 - Math.max(candidate.bounds.left - (radical.bounds.right + radical.bounds.width * 0.2), 0) / Math.max(28, radical.bounds.width * 0.3), 0, 1)
  return horizontalOverlap * 0.36 + verticalOverlap * 0.24 + leftProgress * 0.18 + rightPenalty * 0.22
}

const getCrossRadicalStructureBarrier = (
  groupMap: Map<string, StrokeGroup>,
  radicalGroups: StrokeGroup[],
  parentGroupId: string | null | undefined,
  childGroupId: string | null | undefined,
  ignoredGroupIds: Set<string> = new Set(),
) => {
  if (!parentGroupId || !childGroupId) return null
  const parentGroup = groupMap.get(parentGroupId)
  const childGroup = groupMap.get(childGroupId)
  if (!parentGroup || !childGroup) return null

  const barriers = radicalGroups
    .filter((group) => group.id !== parentGroupId && group.id !== childGroupId)
    .filter((group) => !ignoredGroupIds.has(group.id))
    .map((radical) => {
      const parentIndexFit = getRadicalIndexFitScore(radical, parentGroup)
      const parentInteriorFit = getRadicalInteriorFitScore(radical, parentGroup)
      const childIndexFit = getRadicalIndexFitScore(radical, childGroup)
      const childInteriorFit = getRadicalInteriorFitScore(radical, childGroup)
      const crossHostedZones = Math.max(
        Math.sqrt(Math.max(parentIndexFit, 0) * Math.max(childInteriorFit, 0)),
        Math.sqrt(Math.max(parentInteriorFit, 0) * Math.max(childIndexFit, 0)),
      )
      if (crossHostedZones < 0.46) return null

      const radicalCentrality = clamp(
        1 - Math.abs(radical.bounds.centerX - (parentGroup.bounds.centerX + childGroup.bounds.centerX) / 2)
          / Math.max(26, Math.abs(childGroup.bounds.centerX - parentGroup.bounds.centerX) * 0.72 + radical.bounds.width * 0.18),
        0,
        1,
      )
      const score = crossHostedZones * 0.72 + radicalCentrality * 0.28

      return {
        groupId: radical.id,
        family: 'radicalBrick' as const,
        score,
      }
    })
    .filter(Boolean)
    .sort((left, right) => (right?.score || 0) - (left?.score || 0))

  return (barriers[0]?.score || 0) >= 0.52 ? barriers[0] : null
}

const getRadicalWholeScriptHostBarrier = (
  groupMap: Map<string, StrokeGroup>,
  radicalGroups: StrokeGroup[],
  parentGroupId: string | null | undefined,
  childGroupId: string | null | undefined,
  ignoredGroupIds: Set<string> = new Set(),
) => {
  if (!parentGroupId || !childGroupId) return null
  const parentGroup = groupMap.get(parentGroupId)
  const childGroup = groupMap.get(childGroupId)
  if (!parentGroup || !childGroup) return null

  const barriers = radicalGroups
    .filter((group) => group.id !== parentGroupId && group.id !== childGroupId)
    .filter((group) => !ignoredGroupIds.has(group.id))
    .map((radical) => {
      const parentInteriorGeometryFit = (
        parentGroup.bounds.left >= radical.bounds.left + radical.bounds.width * 0.34
        && parentGroup.bounds.centerX >= radical.bounds.centerX
        && parentGroup.bounds.top <= radical.bounds.bottom + Math.max(12, radical.bounds.height * 0.18)
        && parentGroup.bounds.bottom >= radical.bounds.top - Math.max(8, radical.bounds.height * 0.08)
      ) ? 0.74 : 0
      const parentIndexGeometryFit = (
        parentGroup.bounds.right <= radical.bounds.left + radical.bounds.width * 0.18
        && parentGroup.bounds.bottom <= radical.bounds.top + radical.bounds.height * 0.2
      ) ? 0.68 : 0
      const parentHostedFit = Math.max(
        getRadicalInteriorFitScore(radical, parentGroup),
        getRadicalIndexFitScore(radical, parentGroup),
        parentInteriorGeometryFit,
        parentIndexGeometryFit,
      )
      if (parentHostedFit < 0.32) return null
      const radicalExtentRight = Math.max(radical.bounds.right, parentGroup.bounds.right)
      const childRightwardGap = childGroup.bounds.left - radicalExtentRight
      const childBeyondWholeRadical = clamp(childRightwardGap / Math.max(18, radical.bounds.width * 0.22), 0, 1)
      if (childBeyondWholeRadical < 0.3) return null
      const verticalAlignment = clamp(
        1 - Math.abs(childGroup.bounds.centerY - parentGroup.bounds.centerY) / Math.max(42, Math.max(childGroup.bounds.height, parentGroup.bounds.height) * 1.2),
        0,
        1,
      )
      const score = parentHostedFit * 0.54 + childBeyondWholeRadical * 0.34 + verticalAlignment * 0.12
      return {
        groupId: radical.id,
        family: 'radicalBrick' as const,
        score,
      }
    })
    .filter(Boolean)
    .sort((left, right) => (right?.score || 0) - (left?.score || 0))

  return (barriers[0]?.score || 0) >= 0.48 ? barriers[0] : null
}


const getInlineFieldKind = (direction: 'left' | 'right') => {
  return direction === 'left' ? 'leftInline' : 'rightInline'
}

const getInlineFieldWeight = (
  brickHypothesesByGroupId: Map<string, LegoBrickHypothesis[]>,
  groupId: string | null | undefined,
  direction: 'left' | 'right',
) => {
  return getBlendedInlineFieldWeight(brickHypothesesByGroupId, groupId, direction)
}

const getInlineAffordanceScore = (
  brickHypothesesByGroupId: Map<string, LegoBrickHypothesis[]>,
  leftGroupId: string | null | undefined,
  rightGroupId: string | null | undefined,
) => {
  const leftWeight = getInlineFieldWeight(brickHypothesesByGroupId, leftGroupId, 'right')
  const rightWeight = getInlineFieldWeight(brickHypothesesByGroupId, rightGroupId, 'left')
  if (leftWeight === null || rightWeight === null) {
    return {
      supported: true,
      inlineAffordanceScore: 1,
      leftWeight,
      rightWeight,
    }
  }

  const inlineAffordanceScore = clamp(Math.sqrt(Math.max(leftWeight, 0) * Math.max(rightWeight, 0)), 0, 1)
  return {
    supported: inlineAffordanceScore >= LEGO_SEQUENCE_CONTEXT_MIN_INLINE_SCORE,
    inlineAffordanceScore,
    leftWeight,
    rightWeight,
  }
}

type FieldClaimSupport = {
  score: number
  dominant: boolean
  dominantHostGroupId: string | null
  strongestCompetingScore: number
  strongestCompetingHostGroupId: string | null
  competitionMargin: number
  closureRatio: number
  targetHostedRatio: number
  realizationScore: number
  directionalCompatibilityScore: number
  sharedCompatibilityScore: number
  latentPenalty: number
  fieldDirection: LegoFieldClaim['fieldDirection'] | null
  fieldTopology: LegoFieldClaim['fieldTopology'] | null
  counterpartFieldKind: LegoFieldClaim['counterpartFieldKind'] | null
  counterpartFieldScore: number
  evidence: string[]
}

type InlinePairClaimSupport = {
  score: number
  supported: boolean
  leftClaim: FieldClaimSupport
  rightClaim: FieldClaimSupport
  evidence: string[]
}

const EMPTY_FIELD_CLAIM_SUPPORT: FieldClaimSupport = {
  score: 0,
  dominant: false,
  dominantHostGroupId: null,
  strongestCompetingScore: 0,
  strongestCompetingHostGroupId: null,
  competitionMargin: 0,
  closureRatio: 0,
  targetHostedRatio: 0,
  realizationScore: 0,
  directionalCompatibilityScore: 0,
  sharedCompatibilityScore: 0,
  latentPenalty: 0,
  fieldDirection: null,
  fieldTopology: null,
  counterpartFieldKind: null,
  counterpartFieldScore: 0,
  evidence: [],
}

const buildFieldClaimMap = (fieldClaims: LegoFieldClaim[]) => {
  const claimMap = new Map<string, LegoFieldClaim[]>()

  for (const claim of [...fieldClaims].sort((left, right) => right.score - left.score || left.hostGroupId.localeCompare(right.hostGroupId))) {
    const bucket = claimMap.get(claim.targetGroupId) || []
    bucket.push(claim)
    claimMap.set(claim.targetGroupId, bucket)
  }

  return claimMap
}

const getFieldClaimSupport = (
  fieldClaimsByTargetGroupId: Map<string, LegoFieldClaim[]>,
  targetGroupId: string,
  hostGroupId: string | null | undefined,
  fieldKind: LegoFieldClaim['fieldKind'],
): FieldClaimSupport => {
  const candidates = (fieldClaimsByTargetGroupId.get(targetGroupId) || [])
    .filter((claim) => claim.fieldKind === fieldKind)
    .sort((left, right) => (
      right.score - left.score
      || right.realizationScore - left.realizationScore
      || right.targetHostedRatio - left.targetHostedRatio
      || right.sharedCompatibilityScore - left.sharedCompatibilityScore
      || right.overlapRatio - left.overlapRatio
    ))
  const directClaim = hostGroupId ? candidates.find((claim) => claim.hostGroupId === hostGroupId) || null : null
  const dominantClaim = candidates[0] || null
  const competingClaim = candidates.find((claim) => claim.hostGroupId !== hostGroupId) || null
  const directScore = directClaim?.score || 0
  const strongestCompetingScore = competingClaim?.score || 0
  const competitionMargin = directScore - strongestCompetingScore

  return {
    score: directScore,
    dominant: Boolean(directClaim && dominantClaim?.hostGroupId === hostGroupId),
    dominantHostGroupId: dominantClaim?.hostGroupId || null,
    strongestCompetingScore,
    strongestCompetingHostGroupId: competingClaim?.hostGroupId || null,
    competitionMargin,
    closureRatio: directClaim?.closureRatio || 0,
    targetHostedRatio: directClaim?.targetHostedRatio || 0,
    realizationScore: directClaim?.realizationScore || 0,
    directionalCompatibilityScore: directClaim?.directionalCompatibilityScore || 0,
    sharedCompatibilityScore: directClaim?.sharedCompatibilityScore || 0,
    latentPenalty: directClaim?.latentPenalty || 0,
    fieldDirection: directClaim?.fieldDirection || null,
    fieldTopology: directClaim?.fieldTopology || null,
    counterpartFieldKind: directClaim?.counterpartFieldKind || null,
    counterpartFieldScore: directClaim?.counterpartFieldScore || 0,
    evidence: [
      `field-claim=${fieldKind}:${directScore.toFixed(3)}`,
      `field-claim-dominant=${directClaim && dominantClaim?.hostGroupId === hostGroupId ? 'true' : 'false'}`,
      `field-claim-dominant-host=${dominantClaim?.hostGroupId || 'none'}`,
      `field-claim-competing=${strongestCompetingScore.toFixed(3)}`,
      `field-claim-margin=${competitionMargin.toFixed(3)}`,
      `field-closure=${(directClaim?.closureRatio || 0).toFixed(3)}`,
      `field-hosted=${(directClaim?.targetHostedRatio || 0).toFixed(3)}`,
      `field-realization=${(directClaim?.realizationScore || 0).toFixed(3)}`,
      `field-directional=${(directClaim?.directionalCompatibilityScore || 0).toFixed(3)}`,
      `field-shared=${(directClaim?.sharedCompatibilityScore || 0).toFixed(3)}`,
      `field-latent-penalty=${(directClaim?.latentPenalty || 0).toFixed(3)}`,
      `field-topology=${directClaim?.fieldTopology || 'none'}`,
      `field-direction=${directClaim?.fieldDirection || 'none'}`,
      `field-counterpart=${directClaim?.counterpartFieldKind || 'none'}:${(directClaim?.counterpartFieldScore || 0).toFixed(3)}`,
    ],
  }
}

const getScriptFieldClaimSupport = (
  fieldClaimsByTargetGroupId: Map<string, LegoFieldClaim[]>,
  childGroupId: string,
  parentGroupId: string | null | undefined,
  role: 'superscript' | 'subscript',
) => getFieldClaimSupport(fieldClaimsByTargetGroupId, childGroupId, parentGroupId, getScriptFieldKind(role))

const getCompetingInlineClaimSupport = (
  fieldClaimsByTargetGroupId: Map<string, LegoFieldClaim[]>,
  childGroupId: string,
  parentGroupId: string | null | undefined,
) => getFieldClaimSupport(fieldClaimsByTargetGroupId, childGroupId, parentGroupId, 'rightInline')

const shouldSuppressScriptByInlineOccupancy = (
  scriptClaimSupport: FieldClaimSupport,
  inlineClaimSupport: FieldClaimSupport,
) => {
  const hostedAdvantage = inlineClaimSupport.targetHostedRatio - scriptClaimSupport.targetHostedRatio
  const scoreAdvantage = inlineClaimSupport.score - scriptClaimSupport.score

  return inlineClaimSupport.score >= SCRIPT_INLINE_SUPPRESSION_MIN_INLINE_SCORE
    && hostedAdvantage >= SCRIPT_INLINE_SUPPRESSION_MIN_HOSTED_ADVANTAGE
    && scoreAdvantage >= SCRIPT_INLINE_SUPPRESSION_MIN_SCORE_ADVANTAGE
}

const shouldBlockSequenceWideSubscriptByImmediateInlineClaim = (
  scriptClaimSupport: FieldClaimSupport,
  inlineClaimSupport: FieldClaimSupport,
) => {
  const hostedAdvantage = inlineClaimSupport.targetHostedRatio - scriptClaimSupport.targetHostedRatio
  const scoreAdvantage = inlineClaimSupport.score - scriptClaimSupport.score

  return inlineClaimSupport.score >= 0.5
    && inlineClaimSupport.competitionMargin >= -0.08
    && (
      inlineClaimSupport.dominant
      || hostedAdvantage >= 0.12
      || scoreAdvantage >= 0.08
    )
}

const allowsSequenceWideTrailingScriptPromotion = (
  groupMap: Map<string, StrokeGroup>,
  brickHypothesesByGroupId: Map<string, LegoBrickHypothesis[]>,
  topBrickHypothesisByGroupId: Map<string, LegoBrickHypothesis>,
  fieldClaimsByTargetGroupId: Map<string, LegoFieldClaim[]>,
  parentGroupId: string | null | undefined,
  childGroupId: string,
  role: 'superscript' | 'subscript',
) => {
  if (!isLikelySequenceWideScript(parentGroupId, childGroupId, groupMap, brickHypothesesByGroupId, topBrickHypothesisByGroupId)) {
    return false
  }

  if (role !== 'subscript' || !parentGroupId) {
    return true
  }

  const scriptClaimSupport = getScriptFieldClaimSupport(fieldClaimsByTargetGroupId, childGroupId, parentGroupId, role)
  const inlineClaimSupport = getCompetingInlineClaimSupport(fieldClaimsByTargetGroupId, childGroupId, parentGroupId)
  return !shouldBlockSequenceWideSubscriptByImmediateInlineClaim(scriptClaimSupport, inlineClaimSupport)
}

const getInlinePairClaimSupport = (
  fieldClaimsByTargetGroupId: Map<string, LegoFieldClaim[]>,
  leftGroupId: string | null | undefined,
  rightGroupId: string | null | undefined,
): InlinePairClaimSupport => {
  const leftClaim = leftGroupId && rightGroupId
    ? getFieldClaimSupport(fieldClaimsByTargetGroupId, leftGroupId, rightGroupId, 'leftInline')
    : EMPTY_FIELD_CLAIM_SUPPORT
  const rightClaim = leftGroupId && rightGroupId
    ? getFieldClaimSupport(fieldClaimsByTargetGroupId, rightGroupId, leftGroupId, 'rightInline')
    : EMPTY_FIELD_CLAIM_SUPPORT
  const score = clamp(
    Math.sqrt(Math.max(leftClaim.score, 0) * Math.max(rightClaim.score, 0)) * 0.34
      + Math.sqrt(Math.max(leftClaim.realizationScore, 0) * Math.max(rightClaim.realizationScore, 0)) * 0.22
      + Math.sqrt(Math.max(leftClaim.directionalCompatibilityScore, 0) * Math.max(rightClaim.directionalCompatibilityScore, 0)) * 0.14
      + Math.max(leftClaim.sharedCompatibilityScore, rightClaim.sharedCompatibilityScore) * 0.08
      + Math.max(leftClaim.score, rightClaim.score) * 0.14
      + (leftClaim.dominant && rightClaim.dominant ? 0.08 : 0),
    0,
    1,
  )

  return {
    score,
    supported: score >= 0.34 && leftClaim.competitionMargin > -0.18 && rightClaim.competitionMargin > -0.18,
    leftClaim,
    rightClaim,
    evidence: [
      `inline-field-pair=${score.toFixed(3)}`,
      `inline-left-claim=${leftClaim.score.toFixed(3)}`,
      `inline-right-claim=${rightClaim.score.toFixed(3)}`,
      `inline-left-realization=${leftClaim.realizationScore.toFixed(3)}`,
      `inline-right-realization=${rightClaim.realizationScore.toFixed(3)}`,
      `inline-left-margin=${leftClaim.competitionMargin.toFixed(3)}`,
      `inline-right-margin=${rightClaim.competitionMargin.toFixed(3)}`,
    ],
  }
}

const getSubexpressionFieldClaimSupport = (
  subexpression: LocalSubexpression,
  fieldClaimsByTargetGroupId: Map<string, LegoFieldClaim[]>,
  hostGroupId: string,
  fieldKind: LegoFieldClaim['fieldKind'],
) => {
  const memberClaims = subexpression.memberGroupIds
    .map((groupId) => getFieldClaimSupport(fieldClaimsByTargetGroupId, groupId, hostGroupId, fieldKind))
    .filter((claim) => claim.score > 0)
    .sort((left, right) => right.score - left.score)
  const rootClaim = getFieldClaimSupport(fieldClaimsByTargetGroupId, subexpression.rootGroupId, hostGroupId, fieldKind)
  const topScore = memberClaims[0]?.score || rootClaim.score || 0
  const averageScore = memberClaims.length
    ? memberClaims.reduce((sum, claim) => sum + claim.score, 0) / memberClaims.length
    : rootClaim.score
  const averageRealizationScore = memberClaims.length
    ? memberClaims.reduce((sum, claim) => sum + claim.realizationScore, 0) / memberClaims.length
    : rootClaim.realizationScore
  const averageDirectionalCompatibilityScore = memberClaims.length
    ? memberClaims.reduce((sum, claim) => sum + claim.directionalCompatibilityScore, 0) / memberClaims.length
    : rootClaim.directionalCompatibilityScore
  const coverageScore = memberClaims.length / Math.max(1, subexpression.memberGroupIds.length)
  const score = clamp(
    topScore * 0.32
      + averageScore * 0.2
      + averageRealizationScore * 0.18
      + averageDirectionalCompatibilityScore * 0.1
      + coverageScore * 0.12
      + (rootClaim.dominant ? 0.08 : 0),
    0,
    1,
  )

  return {
    score,
    topScore,
    averageScore,
    averageRealizationScore,
    averageDirectionalCompatibilityScore,
    coverageScore,
    rootClaim,
    evidence: [
      `hosted-claim=${fieldKind}:${score.toFixed(3)}`,
      `hosted-claim-top=${topScore.toFixed(3)}`,
      `hosted-claim-average=${averageScore.toFixed(3)}`,
      `hosted-claim-realization=${averageRealizationScore.toFixed(3)}`,
      `hosted-claim-directional=${averageDirectionalCompatibilityScore.toFixed(3)}`,
      `hosted-claim-coverage=${coverageScore.toFixed(3)}`,
    ],
  }
}

const sequenceContextAllowsRoot = (
  topBrickHypothesisByGroupId: Map<string, LegoBrickHypothesis>,
  groupId: string | null | undefined,
) => {
  if (!groupId) return false
  const topHypothesis = topBrickHypothesisByGroupId.get(groupId)
  if (!topHypothesis) return true
  return topHypothesis.family !== 'fractionBarBrick' && topHypothesis.family !== 'enclosureBoundaryBrick'
}

const roleDepth = (roleMap: Map<string, StructuralRole>, groupId: string) => {
  let depth = 0
  let current = roleMap.get(groupId)
  let seen = 0
  while (current?.parentGroupId && seen < 8) {
    depth += 1
    current = roleMap.get(current.parentGroupId)
    seen += 1
  }
  return depth
}

const chooseBestCandidate = (candidates: StructuralRoleCandidate[]) => {
  return [...candidates].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    if (left.role === 'baseline' && right.role !== 'baseline') return 1
    if (right.role === 'baseline' && left.role !== 'baseline') return -1
    return left.role.localeCompare(right.role)
  })[0]
}

const stripCompetitionEvidence = (evidence: string[] = []) => (
  evidence.filter((entry) => (
    !entry.startsWith('claiming-evidence=')
    && !entry.startsWith('counter-evidence-reinforcement=')
    && !entry.startsWith('counter-evidence-source=')
  ))
)

const rebalanceCompetingCandidates = (candidates: StructuralRoleCandidate[]) => {
  if (candidates.length < 2) return candidates

  const maxScore = candidates.reduce((highest, candidate) => Math.max(highest, candidate.score), 0)
  const claimRange = Math.max(0.16, maxScore - COMPETING_INTERPRETATION_MIN_CLAIM_SCORE)

  return candidates.map((candidate, candidateIndex) => {
    const claimStrength = clamp((candidate.score - COMPETING_INTERPRETATION_MIN_CLAIM_SCORE) / claimRange, 0, 1)
    if (claimStrength <= 0) {
      return {
        ...candidate,
        evidence: stripCompetitionEvidence(candidate.evidence || []),
      }
    }

    let strongestRival: StructuralRoleCandidate | null = null
    let strongestTransfer = 0
    let totalTransfer = 0
    let transferCount = 0

    for (let rivalIndex = 0; rivalIndex < candidates.length; rivalIndex += 1) {
      if (rivalIndex === candidateIndex) continue
      const rival = candidates[rivalIndex]
      const rivalWeakness = clamp(1 - rival.score, 0, 1)
      if (rivalWeakness <= 0) continue

      const rivalLead = Math.max(rival.score - candidate.score, 0)
      const rivalryEligibility = clamp(1 - rivalLead / COMPETING_INTERPRETATION_MAX_RIVAL_MARGIN, 0, 1)
      if (rivalryEligibility <= 0) continue

      const pairTransfer = rivalWeakness * rivalryEligibility
      if (pairTransfer <= 0) continue

      totalTransfer += pairTransfer
      transferCount += 1
      if (pairTransfer > strongestTransfer) {
        strongestTransfer = pairTransfer
        strongestRival = rival
      }
    }

    if (!transferCount) {
      return {
        ...candidate,
        evidence: stripCompetitionEvidence(candidate.evidence || []),
      }
    }

    const reinforcementBoost = clamp(
      claimStrength * (totalTransfer / transferCount) * COMPETING_INTERPRETATION_TRANSFER_WEIGHT,
      0,
      0.12,
    )

    const evidence = stripCompetitionEvidence(candidate.evidence || [])
    if (reinforcementBoost < 0.01) {
      return {
        ...candidate,
        evidence,
      }
    }

    return {
      ...candidate,
      score: clamp(candidate.score + reinforcementBoost, 0, 1),
      evidence: [
        ...evidence,
        `claiming-evidence=${candidate.score.toFixed(3)}`,
        `counter-evidence-reinforcement=+${reinforcementBoost.toFixed(3)}`,
        strongestRival ? `counter-evidence-source=${strongestRival.role}:${strongestRival.score.toFixed(3)}` : undefined,
      ].filter(Boolean) as string[],
    }
  })
}

const findBestAdmissibleScriptEdge = (
  edges: LayoutEdge[],
  role: 'superscript' | 'subscript',
  groupMap: Map<string, StrokeGroup>,
  topBrickHypothesisByGroupId: Map<string, LegoBrickHypothesis>,
  fieldClaimsByTargetGroupId: Map<string, LegoFieldClaim[]>,
  fractionBarrierGroups: StrokeGroup[] = [],
  radicalBarrierGroups: StrokeGroup[] = [],
) => {
  const orderedEdges = [...edges].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    const leftGap = left.metrics.horizontalGap ?? Number.POSITIVE_INFINITY
    const rightGap = right.metrics.horizontalGap ?? Number.POSITIVE_INFINITY
    if (leftGap !== rightGap) return leftGap - rightGap
    const leftDx = Math.abs(left.metrics.dx ?? Number.POSITIVE_INFINITY)
    const rightDx = Math.abs(right.metrics.dx ?? Number.POSITIVE_INFINITY)
    if (leftDx !== rightDx) return leftDx - rightDx
    return left.fromId.localeCompare(right.fromId)
  })

  for (const edge of orderedEdges) {
    const parentGroup = groupMap.get(edge.fromId) || null
    const childGroup = groupMap.get(edge.toId) || null
    const lineLikeChild = childGroup ? getMinusBaselineClaimScore(childGroup) >= 0.85 : false
    const childFamily = topBrickHypothesisByGroupId.get(edge.toId)?.family || null
    if (isDisallowedScriptChildFamily(childFamily, lineLikeChild)) continue
    if (role === 'superscript' && (edge.metrics.dy || 0) >= 0) continue
    const hostFieldSupport = hostSupportsScriptField(topBrickHypothesisByGroupId, edge.fromId, role)
    const claimSupport = getScriptFieldClaimSupport(fieldClaimsByTargetGroupId, edge.toId, edge.fromId, role)
    const inlineClaimSupport = getCompetingInlineClaimSupport(fieldClaimsByTargetGroupId, edge.toId, edge.fromId)
    const localGeometrySupport = parentGroup
      ? clamp(1 - (edge.metrics.horizontalGap ?? 0) / Math.max(24, parentGroup.bounds.width * 0.92), 0, 1)
      : 1
    const strongLocalGeometry = edge.score >= 0.58
      || lineLikeChild
      || (role === 'subscript' && Math.max(edge.metrics.belowRightScore || 0, edge.metrics.directlyBelowScore || 0) >= 0.5)
    const lineLikeInlineBaselineSupport = lineLikeChild && childGroup
      ? getInlineNeighborBaselineClaimScore(childGroup, Array.from(groupMap.values())) >= 0.82
      : false
    const lineLikeVerticalScriptSupport = lineLikeChild && parentGroup && childGroup
      ? (() => {
          const minimumDisplacement = Math.max(14, Math.min(parentGroup.bounds.height, childGroup.bounds.height) * 0.8)
          if (role === 'superscript') {
            return (edge.metrics.dy || 0) <= -minimumDisplacement
          }
          return (edge.metrics.dy || 0) >= minimumDisplacement
            || Math.max(edge.metrics.belowRightScore || 0, edge.metrics.directlyBelowScore || 0) >= 0.35
        })()
      : true
    const stackedBaselinePenalty = role === 'subscript'
      && !lineLikeChild
      && (edge.metrics.overlapX || 0) >= 0.5
      && (edge.metrics.sizeRatio || 0) >= 1.05
      && Math.abs(edge.metrics.dx || 0) <= Math.max(18, parentGroup?.bounds.width || 0)
        ? 0.12
        : 0
    const stackedBaselineLikeSubscript = role === 'subscript'
      && !lineLikeChild
      && (edge.metrics.overlapX || 0) >= 0.48
      && (edge.metrics.sizeRatio || 0) >= 1.02
      && (edge.metrics.directlyBelowScore || 0) < 0.18
      && Math.abs(edge.metrics.dx || 0) <= Math.max(24, parentGroup?.bounds.width || 0)
    if (!hostFieldSupport.supported) continue
    if (lineLikeInlineBaselineSupport) continue
    if (!lineLikeVerticalScriptSupport) continue
    if (stackedBaselineLikeSubscript) continue
    if (shouldSuppressScriptByInlineOccupancy(claimSupport, inlineClaimSupport)) continue
    if (!strongLocalGeometry && localGeometrySupport >= 0.4 && claimSupport.score < 0.2 && claimSupport.strongestCompetingScore >= 0.48) continue
    if (!strongLocalGeometry && localGeometrySupport >= 0.4 && claimSupport.competitionMargin < -0.14 && claimSupport.strongestCompetingScore >= 0.4) continue
    if (getDirectScriptHostBarrier(groupMap, topBrickHypothesisByGroupId, edge.fromId, edge.toId)) continue
    if (getCrossFractionStructureBarrier(groupMap, fractionBarrierGroups, edge.fromId, edge.toId)) continue
    if (getCrossRadicalStructureBarrier(groupMap, radicalBarrierGroups, edge.fromId, edge.toId)) continue
    if (getRadicalWholeScriptHostBarrier(groupMap, radicalBarrierGroups, edge.fromId, edge.toId)) continue
    const inlineHostedAdvantage = Math.max(0, inlineClaimSupport.targetHostedRatio - claimSupport.targetHostedRatio)
    const inlineScoreAdvantage = Math.max(0, inlineClaimSupport.score - claimSupport.score)
    const adjustedScore = clamp(
      edge.score * 0.84
        + claimSupport.score * (strongLocalGeometry ? 0.06 : 0.08 * localGeometrySupport)
        + claimSupport.targetHostedRatio * 0.06
        + claimSupport.realizationScore * 0.08
        + claimSupport.directionalCompatibilityScore * 0.08
        + claimSupport.sharedCompatibilityScore * 0.06
        + claimSupport.closureRatio * 0.04
        + (claimSupport.dominant ? (strongLocalGeometry ? 0.02 : 0.03 * localGeometrySupport) : 0)
        - Math.max(0, claimSupport.strongestCompetingScore - claimSupport.score) * (strongLocalGeometry ? 0.03 : 0.08 * localGeometrySupport)
        - inlineHostedAdvantage * (strongLocalGeometry ? 0.1 : 0.16)
        - inlineScoreAdvantage * (strongLocalGeometry ? 0.06 : 0.12)
        - claimSupport.latentPenalty * 0.08
        - stackedBaselinePenalty,
      0,
      1,
    )
    return { edge, hostFieldSupport, claimSupport, inlineClaimSupport, adjustedScore }
  }
  return null
}

const makeCandidate = (
  role: StructuralRoleKind,
  score: number,
  parentGroupId?: string | null,
  evidence: string[] = [],
  options: Pick<StructuralRoleCandidate, 'associationContextId' | 'containerGroupIds' | 'normalizationAnchorGroupIds'> = {},
): StructuralRoleCandidate => ({
  role,
  score,
  parentGroupId: parentGroupId ?? null,
  associationContextId: options.associationContextId ?? null,
  containerGroupIds: options.containerGroupIds || [],
  normalizationAnchorGroupIds: options.normalizationAnchorGroupIds || [],
  evidence,
})

const makeRole = (groupId: string, role: StructuralRoleKind, score: number, depth: number, parentGroupId?: string | null, evidence: string[] = [], containerGroupIds: string[] = [], associationContextId?: string | null, normalizationAnchorGroupIds: string[] = []): StructuralRole => ({
  groupId,
  role,
  descriptor: getRoleDescriptor(role),
  score,
  depth,
  parentGroupId: parentGroupId ?? null,
  associationContextId: associationContextId ?? null,
  normalizationAnchorGroupIds,
  containerGroupIds,
  evidence,
})

type StableAttachment = {
  parentId: string
  childId: string
  role: 'superscript' | 'subscript'
  score: number
}

type RootClaim = {
  rootGroupId: string
  role: 'baseline' | 'numerator' | 'denominator'
}

type FractionStructureBinding = {
  barGroupId: string
  numeratorRootIds: string[]
  denominatorRootIds: string[]
}

type RadicalStructureBinding = {
  radicalGroupId: string
  radicandRootIds: string[]
  indexRootIds: string[]
}

type FractionSideCandidate = {
  subexpression: LocalSubexpression
  bounds: ReturnType<typeof getSubexpressionBounds>
  alignment: ReturnType<typeof scoreFractionMemberAlignment>
  fieldFitScore: number
  hostedClaimScore: number
  occupantBeliefScore: number
  hostMutualReinforcementScore: number
  sideConsistencyScore: number
}

type FractionHypothesis = {
  numerator: FractionSideCandidate
  denominator: FractionSideCandidate
  score: number
  axisConsistency: number
  memberWidthHarmony: number
  hostBeliefScore: number
  occupantMutualScore: number
  localCoherenceScore: number
  globalCompatibilityScore: number
}

type ScoredFractionContext = {
  shapeScore: number
  numeratorRoots: LocalSubexpression[]
  denominatorRoots: LocalSubexpression[]
  numeratorAggregate: ReturnType<typeof scoreFractionMemberAlignment> | null
  denominatorAggregate: ReturnType<typeof scoreFractionMemberAlignment> | null
  barRecognitionScore: number
  memberClaimScore: number
  bestHypothesis: FractionHypothesis | null
  provisionalNumeratorScore: number
  provisionalDenominatorScore: number
  mutualReinforcementScore: number
  localCoherenceScore: number
  globalCompatibilityScore: number
  revisionPressureScore: number
  preferredNumeratorRootId: string | null
  preferredDenominatorRootId: string | null
  evidence?: string[]
}

type FractionBaselineReleaseCandidate = StructuralRoleCandidate

type ScoredFractionBarCandidate = {
  bar: StrokeGroup
  context: ScoredFractionContext
}

const PROVISIONAL_FRACTION_BAR_MIN_SCORE = 0.42
const PROVISIONAL_FRACTION_SIDE_MIN_SCORE = 0.36
const PROVISIONAL_FRACTION_BAR_MINUS_FALLBACK_MIN_SCORE = 0.34
const PROVISIONAL_FRACTION_BAR_MINUS_FALLBACK_MIN_OPERATOR_SCORE = 0.34

type FractionBaselineFallbackSupport = {
  operandSignal: number
  incomingSequenceScore: number
  outgoingSequenceScore: number
  sequenceSupportScore: number
  inlineAffordanceScore: number
  minusGeometryScore: number
  inlineNeighborSupportScore: number
  baselineClaimScore: number
}

const hasConfirmedFractionMemberSupport = (context: ScoredFractionContext) => (
  context.barRecognitionScore >= 0.5
  && context.memberClaimScore >= 0.46
  && context.numeratorRoots.length > 0
  && context.denominatorRoots.length > 0
)

const hasProvisionalFractionMemberSupport = (context: ScoredFractionContext) => (
  context.barRecognitionScore >= PROVISIONAL_FRACTION_BAR_MIN_SCORE
  || context.provisionalNumeratorScore >= PROVISIONAL_FRACTION_SIDE_MIN_SCORE
  || context.provisionalDenominatorScore >= PROVISIONAL_FRACTION_SIDE_MIN_SCORE
)

const getFractionBaselineFallbackSupport = (
  bar: StrokeGroup,
  context: ScoredFractionContext,
  edges: LayoutEdge[],
  groups: StrokeGroup[],
  operatorAlternativeScore: number,
): FractionBaselineFallbackSupport | null => {
  const operandSignal = Math.max(context.memberClaimScore, context.provisionalNumeratorScore, context.provisionalDenominatorScore)
  const bestIncomingSequence = bestIncoming(edges, bar.id, 'sequence')
  const bestOutgoingSequence = bestOutgoing(edges, bar.id, 'sequence')
  const incomingSequenceScore = bestIncomingSequence?.score || 0
  const outgoingSequenceScore = bestOutgoingSequence?.score || 0
  const incomingInlineAffordanceScore = bestIncomingSequence?.metrics.inlineAffordanceScore || 0
  const outgoingInlineAffordanceScore = bestOutgoingSequence?.metrics.inlineAffordanceScore || 0
  const sequenceSupportScore = clamp(
    Math.max(incomingSequenceScore, outgoingSequenceScore) * 0.58
      + Math.min(incomingSequenceScore, outgoingSequenceScore) * 0.22
      + Math.max(incomingInlineAffordanceScore, outgoingInlineAffordanceScore) * 0.2,
    0,
    1,
  )
  const inlineAffordanceScore = Math.max(incomingInlineAffordanceScore, outgoingInlineAffordanceScore)
  const minusGeometryScore = getMinusBaselineClaimScore(bar)
  const inlineNeighborSupportScore = getInlineNeighborBaselineClaimScore(bar, groups)
  if (sequenceSupportScore < 0.22 && inlineNeighborSupportScore < 0.8) return null

  const baselineClaimScore = clamp(
    sequenceSupportScore * 0.18
      + inlineNeighborSupportScore * 0.34
      + inlineAffordanceScore * 0.08
      + operatorAlternativeScore * 0.18
      + minusGeometryScore * 0.22,
    0,
    1,
  )

  return {
    operandSignal,
    incomingSequenceScore,
    outgoingSequenceScore,
    sequenceSupportScore,
    inlineAffordanceScore,
    minusGeometryScore,
    inlineNeighborSupportScore,
    baselineClaimScore,
  }
}

const getMinusBaselineClaimScore = (group: StrokeGroup) => {
  if (group.strokeCount !== 1) return 0
  if (group.bounds.width < Math.max(24, group.bounds.height * 2.4)) return 0
  return clamp((group.aspectRatio - 2.4) / 2.8, 0, 1)
}

const getInlineNeighborBaselineClaimScore = (group: StrokeGroup, groups: StrokeGroup[]) => {
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

  const leftNeighbor = groups
    .filter((candidate) => candidate.id !== group.id)
    .filter((candidate) => candidate.bounds.centerX < group.bounds.centerX)
    .map((candidate) => ({ candidate, score: scoreNeighbor(candidate) }))
    .sort((left, right) => right.score - left.score || right.candidate.bounds.centerX - left.candidate.bounds.centerX)[0] || null

  const rightNeighbor = groups
    .filter((candidate) => candidate.id !== group.id)
    .filter((candidate) => candidate.bounds.centerX > group.bounds.centerX)
    .map((candidate) => ({ candidate, score: scoreNeighbor(candidate) }))
    .sort((left, right) => right.score - left.score || left.candidate.bounds.centerX - right.candidate.bounds.centerX)[0] || null

  if (!leftNeighbor && !rightNeighbor) return 0
  if (leftNeighbor && rightNeighbor) {
    return clamp(leftNeighbor.score * 0.5 + rightNeighbor.score * 0.5, 0, 1)
  }
  return (leftNeighbor?.score || rightNeighbor?.score || 0) * 0.72
}

const shouldPreferInlineOperatorOverFractionLikeRole = (
  group: StrokeGroup,
  edges: LayoutEdge[],
  groups: StrokeGroup[],
  operatorAlternativeScore: number,
) => {
  const bestIncomingSequence = bestIncoming(edges, group.id, 'sequence')
  const bestOutgoingSequence = bestOutgoing(edges, group.id, 'sequence')
  const incomingSequenceScore = bestIncomingSequence?.score || 0
  const outgoingSequenceScore = bestOutgoingSequence?.score || 0
  const bilateralSequenceScore = Math.min(incomingSequenceScore, outgoingSequenceScore)
  const inlineAffordanceScore = Math.max(
    bestIncomingSequence?.metrics.inlineAffordanceScore || 0,
    bestOutgoingSequence?.metrics.inlineAffordanceScore || 0,
  )
  const sequenceSupportScore = clamp(
    Math.max(incomingSequenceScore, outgoingSequenceScore) * 0.34
      + bilateralSequenceScore * 0.42
      + inlineAffordanceScore * 0.24,
    0,
    1,
  )
  const minusGeometryScore = getMinusBaselineClaimScore(group)
  const inlineNeighborSupportScore = getInlineNeighborBaselineClaimScore(group, groups)
  const inlineOperatorScore = clamp(
    sequenceSupportScore * 0.34
      + inlineNeighborSupportScore * 0.28
      + operatorAlternativeScore * 0.2
      + minusGeometryScore * 0.18,
    0,
    1,
  )

  return minusGeometryScore >= 0.72
    && inlineNeighborSupportScore >= 0.72
    && bilateralSequenceScore >= 0.24
    && inlineOperatorScore >= 0.54
}

const suppressStandaloneFractionBarsInsideHostedFraction = (candidates: ScoredFractionBarCandidate[]) => {
  return candidates.filter((candidate) => {
    const hasOwnHostedSupport = hasConfirmedFractionMemberSupport(candidate.context) || hasProvisionalFractionMemberSupport(candidate.context)
    if (hasOwnHostedSupport) return true

    const dominatedByHostedFraction = candidates.some((other) => {
      if (other.bar.id === candidate.bar.id) return false
      if (!hasConfirmedFractionMemberSupport(other.context)) return false
      if (other.bar.bounds.width <= candidate.bar.bounds.width * 1.2) return false

      const horizontalContainment = candidate.bar.bounds.left >= other.bar.bounds.left - Math.max(12, other.bar.bounds.width * 0.06)
        && candidate.bar.bounds.right <= other.bar.bounds.right + Math.max(12, other.bar.bounds.width * 0.06)
      if (!horizontalContainment) return false

      const hostedBandOffset = Math.max(18, other.bar.bounds.height * 6)
      const insideNumeratorBand = candidate.bar.bounds.bottom <= other.bar.bounds.top + hostedBandOffset
      const insideDenominatorBand = candidate.bar.bounds.top >= other.bar.bounds.bottom - hostedBandOffset
      if (!insideNumeratorBand && !insideDenominatorBand) return false

      return true
    })

    return !dominatedByHostedFraction
  })
}

const getFractionBaselineReleaseCandidate = (
  bar: StrokeGroup,
  context: ScoredFractionContext,
  edges: LayoutEdge[],
  groups: StrokeGroup[],
  operatorAlternativeScore: number,
  fractionRole: 'fractionBar' | 'provisionalFractionBar',
  fractionSupportScore: number,
): FractionBaselineReleaseCandidate | null => {
  const fallbackSupport = getFractionBaselineFallbackSupport(bar, context, edges, groups, operatorAlternativeScore)
  if (!fallbackSupport) return null

  const {
    operandSignal,
    incomingSequenceScore,
    outgoingSequenceScore,
    sequenceSupportScore,
    inlineAffordanceScore,
    minusGeometryScore,
    inlineNeighborSupportScore,
    baselineClaimScore,
  } = fallbackSupport
  if (operandSignal >= 0.28) return null
  if (baselineClaimScore < 0.34) return null

  const pairedCandidates = rebalanceCompetingCandidates([
    makeCandidate(fractionRole, fractionSupportScore, null, [
      'fraction-bar side of paired baseline competition',
      `fraction-bar-support=${fractionSupportScore.toFixed(3)}`,
      `shape=${context.shapeScore.toFixed(3)}`,
      `member-claim=${context.memberClaimScore.toFixed(3)}`,
      `operand-signal=${operandSignal.toFixed(3)}`,
    ]),
    makeCandidate('baseline', baselineClaimScore, null, [
      'baseline side of paired fraction-bar competition',
      `sequence-support=${sequenceSupportScore.toFixed(3)}`,
      `incoming-sequence-support=${incomingSequenceScore.toFixed(3)}`,
      `outgoing-sequence-support=${outgoingSequenceScore.toFixed(3)}`,
      `inline-neighbor-support=${inlineNeighborSupportScore.toFixed(3)}`,
      `inline-affordance=${inlineAffordanceScore.toFixed(3)}`,
      `operator-alternative=${operatorAlternativeScore.toFixed(3)}`,
      `minus-geometry=${minusGeometryScore.toFixed(3)}`,
      `pairing=${fractionRole}-vs-baseline`,
    ]),
  ])

  const baselineCandidate = pairedCandidates.find((candidate) => candidate.role === 'baseline') || null
  const fractionCandidate = pairedCandidates.find((candidate) => candidate.role === fractionRole) || null
  if (!baselineCandidate || !fractionCandidate) return null
  if (baselineCandidate.score < fractionCandidate.score + 0.04) return null

  return baselineCandidate
}

const getUnvindicatedFractionMinusFallbackCandidate = (
  bar: StrokeGroup,
  context: ScoredFractionContext,
  edges: LayoutEdge[],
  groups: StrokeGroup[],
  operatorAlternativeScore: number,
): FractionBaselineReleaseCandidate | null => {
  if (hasConfirmedFractionMemberSupport(context)) return null

  const fallbackSupport = getFractionBaselineFallbackSupport(bar, context, edges, groups, operatorAlternativeScore)
  if (!fallbackSupport) return null

  const {
    operandSignal,
    sequenceSupportScore,
    inlineAffordanceScore,
    minusGeometryScore,
    inlineNeighborSupportScore,
    baselineClaimScore,
  } = fallbackSupport

  const hasMinusLikeEvidence = operatorAlternativeScore >= PROVISIONAL_FRACTION_BAR_MINUS_FALLBACK_MIN_OPERATOR_SCORE
    || minusGeometryScore >= 0.72
    || inlineNeighborSupportScore >= 0.78
    || sequenceSupportScore >= 0.32

  if (!hasMinusLikeEvidence) return null
  if (baselineClaimScore < PROVISIONAL_FRACTION_BAR_MINUS_FALLBACK_MIN_SCORE) return null

  return makeCandidate('baseline', Math.max(0.38, baselineClaimScore), null, [
    'unvindicated fraction candidate defaulted to minus-like baseline operator',
    `operand-signal=${operandSignal.toFixed(3)}`,
    `fraction-member-claim=${context.memberClaimScore.toFixed(3)}`,
    `provisional-above=${context.provisionalNumeratorScore.toFixed(3)}`,
    `provisional-below=${context.provisionalDenominatorScore.toFixed(3)}`,
    `sequence-support=${sequenceSupportScore.toFixed(3)}`,
    `inline-affordance=${inlineAffordanceScore.toFixed(3)}`,
    `inline-neighbor-support=${inlineNeighborSupportScore.toFixed(3)}`,
    `operator-alternative=${operatorAlternativeScore.toFixed(3)}`,
    `minus-geometry=${minusGeometryScore.toFixed(3)}`,
  ])
}

const isSameContextStackedPair = (upper: StrokeGroup, lower: StrokeGroup) => {
  const overlapWidth = Math.max(0, Math.min(upper.bounds.right, lower.bounds.right) - Math.max(upper.bounds.left, lower.bounds.left))
  const minWidth = Math.max(1, Math.min(upper.bounds.width, lower.bounds.width))
  const horizontalAlignment = Math.abs(upper.bounds.centerX - lower.bounds.centerX) <= Math.max(26, (upper.bounds.width + lower.bounds.width) * 0.22)
  const verticallyStacked = lower.bounds.top > upper.bounds.bottom + 10 && lower.bounds.top - upper.bounds.bottom <= Math.max(140, (upper.bounds.height + lower.bounds.height) * 2.4)
  const sameColumn = overlapWidth / minWidth >= 0.18 || horizontalAlignment
  return verticallyStacked && sameColumn
}

const getSizeComparabilityScore = (reference: StrokeGroup, candidate: StrokeGroup) => {
  const heightRatio = Math.max(candidate.bounds.height, 1) / Math.max(reference.bounds.height, 1)
  const widthRatio = Math.max(candidate.bounds.width, 1) / Math.max(reference.bounds.width, 1)
  const heightScore = clamp(1 - Math.abs(heightRatio - 0.9) / 1.1, 0, 1)
  const widthScore = clamp(1 - Math.abs(widthRatio - 0.9) / 1.25, 0, 1)
  return heightScore * 0.62 + widthScore * 0.38
}

const getScriptLocalityScore = (role: StructuralRole, parent: StrokeGroup, candidate: StrokeGroup) => {
  const horizontalGap = Math.max(0, candidate.bounds.left - parent.bounds.right)
  const horizontalCloseness = clamp(1 - horizontalGap / Math.max(22, parent.bounds.width * 1.18), 0, 1)
  const targetY = role.role === 'superscript'
    ? parent.bounds.top + parent.bounds.height * 0.08
    : parent.bounds.bottom - parent.bounds.height * 0.08
  const verticalCloseness = role.role === 'superscript'
    ? clamp(1 - Math.abs(candidate.bounds.bottom - targetY) / Math.max(28, parent.bounds.height * 1.2), 0, 1)
    : clamp(1 - Math.abs(candidate.bounds.top - targetY) / Math.max(28, parent.bounds.height * 1.2), 0, 1)
  return horizontalCloseness * 0.58 + verticalCloseness * 0.42
}

const getScriptLocalityScoreByKind = (role: 'superscript' | 'subscript', parent: StrokeGroup, candidate: StrokeGroup) => {
  const horizontalGap = Math.max(0, candidate.bounds.left - parent.bounds.right)
  const horizontalCloseness = clamp(1 - horizontalGap / Math.max(22, parent.bounds.width * 1.18), 0, 1)
  const targetY = role === 'superscript'
    ? parent.bounds.top + parent.bounds.height * 0.08
    : parent.bounds.bottom - parent.bounds.height * 0.08
  const verticalCloseness = role === 'superscript'
    ? clamp(1 - Math.abs(candidate.bounds.bottom - targetY) / Math.max(28, parent.bounds.height * 1.2), 0, 1)
    : clamp(1 - Math.abs(candidate.bounds.top - targetY) / Math.max(28, parent.bounds.height * 1.2), 0, 1)
  return horizontalCloseness * 0.58 + verticalCloseness * 0.42
}

const getSequenceWideScriptLocalityScore = (
  role: 'superscript' | 'subscript',
  sequenceBounds: ReturnType<typeof getSequenceContextBounds>,
  candidate: StrokeGroup,
) => {
  if (!sequenceBounds) return 0
  const sequenceWidth = Math.max(1, sequenceBounds.right - sequenceBounds.left)
  const sequenceHeight = Math.max(1, sequenceBounds.bottom - sequenceBounds.top)
  const horizontalGap = Math.max(0, candidate.bounds.left - sequenceBounds.right)
  const horizontalCloseness = clamp(1 - horizontalGap / Math.max(72, sequenceWidth * 0.6), 0, 1)
  const targetY = role === 'superscript'
    ? sequenceBounds.top + sequenceHeight * 0.08
    : sequenceBounds.bottom - sequenceHeight * 0.08
  const verticalCloseness = role === 'superscript'
    ? clamp(1 - Math.abs(candidate.bounds.bottom - targetY) / Math.max(32, sequenceHeight * 0.9), 0, 1)
    : clamp(1 - Math.abs(candidate.bounds.top - targetY) / Math.max(32, sequenceHeight * 0.9), 0, 1)
  return horizontalCloseness * 0.58 + verticalCloseness * 0.42
}

const demoteMissingOperandScripts = (roles: StructuralRole[]) => {
  const nextRoleMap = new Map(roles.map((role) => [role.groupId, role]))
  const flags: StructuralFlag[] = []

  for (const role of roles) {
    if ((role.role !== 'superscript' && role.role !== 'subscript') || role.parentGroupId) continue
    nextRoleMap.set(role.groupId, makeUnsupportedRole(role, [
      'missing required operand reference for unary operator',
      `required-parent=${String(roleRequiresOperandReference(role.role))}`,
    ]))
    flags.push({
      kind: 'missingOperandReference',
      severity: 'warning',
      groupIds: [role.groupId],
      operatorRole: role.role,
      message: `A ${role.role} candidate was preserved as ink but demoted because unary operators must reference a parent operand.`,
    })
  }

  return {
    roles: Array.from(nextRoleMap.values()),
    flags,
  }
}

const getHostedFractionMemberContext = (groupId: string, contexts: ExpressionContext[]) => {
  return contexts
    .filter((context) => (
      (context.kind === 'numerator'
        || context.kind === 'denominator'
        || context.kind === 'radicand'
        || context.kind === 'radicalIndex')
      && context.memberGroupIds.includes(groupId)
    ))
    .sort((left, right) => left.memberGroupIds.length - right.memberGroupIds.length || left.id.localeCompare(right.id))[0] || null
}

const getHostedContextForRole = (role: StructuralRole, contexts: ExpressionContext[]) => {
  const hostedFractionMemberContext = getHostedFractionMemberContext(role.groupId, contexts)
  if (hostedFractionMemberContext) return hostedFractionMemberContext
  if (!role.containerGroupIds.length) return null
  return contexts.find((context) => (
    context.kind === 'enclosure'
    && role.containerGroupIds.every((groupId) => context.anchorGroupIds.includes(groupId))
  )) || null
}

const getContextBounds = (
  context: ExpressionContext | null | undefined,
  groupMap: Map<string, StrokeGroup>,
  excludedGroupIds: Set<string> = new Set(),
) => {
  if (!context) return null
  const boundsList = context.memberGroupIds
    .filter((groupId) => !excludedGroupIds.has(groupId))
    .map((groupId) => groupMap.get(groupId)?.bounds)
    .filter(Boolean) as StrokeGroup['bounds'][]
  if (!boundsList.length) return null
  return mergeBounds(boundsList.map((bounds) => ({
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
    centerX: bounds.centerX,
    centerY: bounds.centerY,
  })))
}

const isFractionWideOutsideHostedMember = (groupId: string, parentGroupId: string | null | undefined, contexts: ExpressionContext[], groupMap: Map<string, StrokeGroup>) => {
  if (!parentGroupId) return false
  const memberContext = contexts.find((context) => (
    (context.kind === 'numerator' || context.kind === 'denominator')
    && context.semanticRootGroupId === parentGroupId
  )) || null
  if (!memberContext?.parentContextId) return false
  const fractionContext = contexts.find((context) => context.id === memberContext.parentContextId && context.kind === 'fraction') || null
  const fractionBarGroup = fractionContext?.semanticRootGroupId ? groupMap.get(fractionContext.semanticRootGroupId) || null : null
  const scriptGroup = groupMap.get(groupId)
  if (!fractionBarGroup || !scriptGroup) return false
  return scriptGroup.bounds.left >= fractionBarGroup.bounds.right + Math.max(10, fractionBarGroup.bounds.width * 0.08)
}

const getRadicalWideContextForParentGroupId = (
  parentGroupId: string | null | undefined,
  contexts: ExpressionContext[],
) => {
  if (!parentGroupId) return null
  const directRadicalContext = contexts.find((context) => context.kind === 'radical' && context.semanticRootGroupId === parentGroupId) || null
  if (directRadicalContext) return directRadicalContext
  const memberContext = contexts.find((context) => (
    (context.kind === 'radicand' || context.kind === 'radicalIndex')
    && context.semanticRootGroupId === parentGroupId
  )) || null
  if (!memberContext?.parentContextId) return null
  return contexts.find((context) => context.id === memberContext.parentContextId && context.kind === 'radical') || null
}

const isRadicalWideOutsideHostedMember = (
  groupId: string,
  parentGroupId: string | null | undefined,
  contexts: ExpressionContext[],
  groupMap: Map<string, StrokeGroup>,
) => {
  const radicalContext = getRadicalWideContextForParentGroupId(parentGroupId, contexts)
  const radicalBounds = getContextBounds(radicalContext, groupMap, new Set([groupId]))
  const scriptGroup = groupMap.get(groupId)
  if (!radicalBounds || !scriptGroup) return false
  return scriptGroup.bounds.left >= radicalBounds.right + Math.max(12, (radicalBounds.right - radicalBounds.left) * 0.06)
}

const getEnclosureWideContextForParentGroupId = (
  parentGroupId: string | null | undefined,
  contexts: ExpressionContext[],
) => {
  if (!parentGroupId) return null
  return contexts.find((context) => context.kind === 'enclosure' && context.memberGroupIds.includes(parentGroupId)) || null
}

const isEnclosureWideOutsideHostedMember = (
  groupId: string,
  parentGroupId: string | null | undefined,
  contexts: ExpressionContext[],
  groupMap: Map<string, StrokeGroup>,
) => {
  const enclosureContext = getEnclosureWideContextForParentGroupId(parentGroupId, contexts)
  const enclosureBounds = getContextBounds(enclosureContext, groupMap, new Set([groupId]))
  const scriptGroup = groupMap.get(groupId)
  if (!enclosureBounds || !scriptGroup) return false
  return scriptGroup.bounds.left >= enclosureBounds.right + Math.max(12, (enclosureBounds.right - enclosureBounds.left) * 0.04)
}

const isLikelySequenceWideScript = (
  parentGroupId: string | null | undefined,
  childGroupId: string,
  groupMap: Map<string, StrokeGroup>,
  brickHypothesesByGroupId: Map<string, LegoBrickHypothesis[]>,
  topBrickHypothesisByGroupId: Map<string, LegoBrickHypothesis>,
) => {
  if (!parentGroupId) return false
  const parentGroup = groupMap.get(parentGroupId)
  const childGroup = groupMap.get(childGroupId)
  if (!parentGroup || !childGroup) return false
  const clearlyOutsideLocalScriptZone = childGroup.bounds.left >= parentGroup.bounds.right + Math.max(28, parentGroup.bounds.width * 0.9)
  if (!clearlyOutsideLocalScriptZone) return false

  const inlinePeers = Array.from(groupMap.values())
    .filter((candidate) => candidate.id !== parentGroupId && candidate.id !== childGroupId)
    .filter((candidate) => candidate.bounds.centerX < parentGroup.bounds.centerX)
    .filter((candidate) => Math.abs(candidate.bounds.centerY - parentGroup.bounds.centerY) <= Math.max(28, Math.max(candidate.bounds.height, parentGroup.bounds.height) * 0.6))

  return inlinePeers.some((candidate) => getInlineAffordanceScore(brickHypothesesByGroupId, candidate.id, parentGroupId).supported)
}

const appendFractionWideScriptAmbiguities = (roles: StructuralRole[], groups: StrokeGroup[], contexts: ExpressionContext[], ambiguities: StructuralAmbiguity[]) => {
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const contextMap = new Map(contexts.map((context) => [context.id, context]))
  const nextAmbiguities = [...ambiguities]

  for (const role of roles) {
    if ((role.role !== 'superscript' && role.role !== 'subscript') || !role.parentGroupId) continue
    if (!role.associationContextId?.startsWith('context:fraction:')) continue
    if (!isFractionWideOutsideHostedMember(role.groupId, role.parentGroupId, contexts, groupMap)) continue
    if (nextAmbiguities.some((ambiguity) => ambiguity.groupId === role.groupId && ambiguity.reason === 'fraction-wide-script-vs-baseline')) continue

    const detachedContextId = role.associationContextId ? contextMap.get(role.associationContextId)?.parentContextId || 'context:root' : 'context:root'

    nextAmbiguities.push({
      groupId: role.groupId,
      reason: 'fraction-wide-script-vs-baseline',
      chosenRole: role.role,
      candidates: rebalanceCompetingCandidates([
        makeCandidate(role.role, role.score, role.parentGroupId, ['resolved as fraction-wide script promotion'], {
          associationContextId: role.associationContextId,
          containerGroupIds: role.containerGroupIds,
          normalizationAnchorGroupIds: role.normalizationAnchorGroupIds,
        }),
        makeCandidate('baseline', Math.max(0.28, role.score - 0.2), null, ['detached baseline alternative'], {
          associationContextId: detachedContextId,
        }),
      ]),
    })
  }

  return nextAmbiguities
}

const appendEnclosureWideScriptAmbiguities = (roles: StructuralRole[], contexts: ExpressionContext[], ambiguities: StructuralAmbiguity[]) => {
  const contextMap = new Map(contexts.map((context) => [context.id, context]))
  const nextAmbiguities = [...ambiguities]

  for (const role of roles) {
    if ((role.role !== 'superscript' && role.role !== 'subscript') || !role.parentGroupId) continue
    if (!role.associationContextId?.startsWith('context:enclosure:')) continue
    if (role.containerGroupIds.length > 0) continue
    if (nextAmbiguities.some((ambiguity) => ambiguity.groupId === role.groupId && ambiguity.reason === 'enclosure-wide-script-vs-baseline')) continue

    const detachedContextId = contextMap.get(role.associationContextId)?.parentContextId || 'context:root'

    nextAmbiguities.push({
      groupId: role.groupId,
      reason: 'enclosure-wide-script-vs-baseline',
      chosenRole: role.role,
      candidates: rebalanceCompetingCandidates([
        makeCandidate(role.role, role.score, role.parentGroupId, ['resolved as enclosure-wide script promotion'], {
          associationContextId: role.associationContextId,
          containerGroupIds: role.containerGroupIds,
          normalizationAnchorGroupIds: role.normalizationAnchorGroupIds,
        }),
        makeCandidate('baseline', Math.max(0.28, role.score - 0.2), null, ['detached baseline alternative'], {
          associationContextId: detachedContextId,
        }),
      ]),
    })
  }

  return nextAmbiguities
}

const appendRadicalWideScriptAmbiguities = (roles: StructuralRole[], groups: StrokeGroup[], contexts: ExpressionContext[], ambiguities: StructuralAmbiguity[]) => {
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const contextMap = new Map(contexts.map((context) => [context.id, context]))
  const nextAmbiguities = [...ambiguities]

  for (const role of roles) {
    if ((role.role !== 'superscript' && role.role !== 'subscript') || !role.parentGroupId) continue
    if (!role.associationContextId?.startsWith('context:radical:')) continue
    if (!isRadicalWideOutsideHostedMember(role.groupId, role.parentGroupId, contexts, groupMap)) continue
    if (nextAmbiguities.some((ambiguity) => ambiguity.groupId === role.groupId && ambiguity.reason === 'radical-wide-script-vs-baseline')) continue

    const detachedContextId = role.associationContextId ? contextMap.get(role.associationContextId)?.parentContextId || 'context:root' : 'context:root'

    nextAmbiguities.push({
      groupId: role.groupId,
      reason: 'radical-wide-script-vs-baseline',
      chosenRole: role.role,
      candidates: rebalanceCompetingCandidates([
        makeCandidate(role.role, role.score, role.parentGroupId, ['resolved as radical-wide script promotion'], {
          associationContextId: role.associationContextId,
          containerGroupIds: role.containerGroupIds,
          normalizationAnchorGroupIds: role.normalizationAnchorGroupIds,
        }),
        makeCandidate('baseline', Math.max(0.28, role.score - 0.2), null, ['detached baseline alternative'], {
          associationContextId: detachedContextId,
        }),
      ]),
    })
  }

  return nextAmbiguities
}

const promoteSequenceWideScripts = (
  roles: StructuralRole[],
  contexts: ExpressionContext[],
  subexpressions: LocalSubexpression[],
  groups: StrokeGroup[],
  edges: LayoutEdge[],
  brickHypothesesByGroupId: Map<string, LegoBrickHypothesis[]>,
  topBrickHypothesisByGroupId: Map<string, LegoBrickHypothesis>,
) => {
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const roleMap = new Map(roles.map((role) => [role.groupId, role]))
  const fieldClaimsByTargetGroupId = buildFieldClaimMap(buildConcreteLegoFieldLayer(groups, Array.from(topBrickHypothesisByGroupId.values())).fieldClaims)
  const sequenceContexts = contexts.filter((context) => context.kind === 'sequence')
  const scriptContinuationContexts = buildScriptContinuationSequenceContexts(
    roles,
    subexpressions,
    groupMap,
    contexts,
    brickHypothesesByGroupId,
    topBrickHypothesisByGroupId,
  )
  const consumedScriptContinuationMemberIds = new Set(
    scriptContinuationContexts.flatMap((context) => context.memberGroupIds),
  )

  return roles.map((role) => {
    if (role.role !== 'baseline' || role.parentGroupId) return role
    if (consumedScriptContinuationMemberIds.has(role.groupId)) return role
    const roleGroup = groupMap.get(role.groupId) || null
    const lineLikeChild = roleGroup ? getMinusBaselineClaimScore(roleGroup) >= 0.85 : false
    if (isDisallowedScriptChildFamily(topBrickHypothesisByGroupId.get(role.groupId)?.family || null, lineLikeChild)) return role

    const scriptCandidates = (['superscript', 'subscript'] as const)
      .map((scriptRole) => {
        const bestEdge = incomingByKind(edges, role.groupId, scriptRole === 'superscript' ? 'superscriptCandidate' : 'subscriptCandidate')[0] || null
        if (!bestEdge) return null

        const parentRole = roleMap.get(bestEdge.fromId) || null
        if (!parentRole || parentRole.role !== 'baseline') return null

        const sequenceContext = sequenceContexts.find((context) => context.memberGroupIds.includes(parentRole.groupId)) || null
        if (!sequenceContext) return null

        const scriptGroup = groupMap.get(role.groupId)
        const effectiveAnchorGroupIds = sequenceContext.anchorGroupIds.filter((groupId) => groupId !== role.groupId)
        const effectiveMemberGroupIds = sequenceContext.memberGroupIds.filter((groupId) => groupId !== role.groupId)
        if (effectiveMemberGroupIds.length < 2 || !effectiveMemberGroupIds.includes(parentRole.groupId)) return null
        const effectiveSequenceContext = {
          ...sequenceContext,
          anchorGroupIds: effectiveAnchorGroupIds,
          memberGroupIds: effectiveMemberGroupIds,
        }
        const sequenceBounds = getSequenceContextBounds(effectiveSequenceContext, groupMap)
        const rightmostAnchorGroupId = getRightmostAnchorGroupId(effectiveSequenceContext, groupMap)
        const rightmostAnchorGroup = rightmostAnchorGroupId ? groupMap.get(rightmostAnchorGroupId) || null : null
        if (!sequenceBounds || !scriptGroup || !rightmostAnchorGroup) return null
        if (scriptGroup.bounds.left < sequenceBounds.right + Math.max(12, (sequenceBounds.right - sequenceBounds.left) * 0.06)) return null

        const hostFieldSupport = hostSupportsScriptField(topBrickHypothesisByGroupId, rightmostAnchorGroupId, scriptRole)
        const claimSupport = getScriptFieldClaimSupport(fieldClaimsByTargetGroupId, role.groupId, rightmostAnchorGroupId, scriptRole)
        const inlineClaimSupport = getCompetingInlineClaimSupport(fieldClaimsByTargetGroupId, role.groupId, rightmostAnchorGroupId)
        const relaxedSequenceSubscriptHost = scriptRole === 'subscript'
          && effectiveMemberGroupIds.length >= 3
          && effectiveAnchorGroupIds.length >= 2
        if (!hostFieldSupport.supported && !relaxedSequenceSubscriptHost) return null
        if (scriptRole === 'subscript' && shouldBlockSequenceWideSubscriptByImmediateInlineClaim(claimSupport, inlineClaimSupport)) return null

        const localAnchorLocalityScore = getScriptLocalityScoreByKind(scriptRole, rightmostAnchorGroup, scriptGroup)
        const sequenceWideLocalityScore = getSequenceWideScriptLocalityScore(scriptRole, sequenceBounds, scriptGroup)
        const localityScore = scriptRole === 'subscript'
          ? Math.max(localAnchorLocalityScore, sequenceWideLocalityScore)
          : localAnchorLocalityScore
        if (localityScore < (scriptRole === 'subscript' ? 0.28 : 0.34)) return null

        const promotedScore = Math.max(bestEdge.score, 0.26 + localityScore * 0.22 + claimSupport.score * 0.14 + (claimSupport.dominant ? 0.04 : 0))
        if (promotedScore < 0.35) return null
        if (promotedScore + (scriptRole === 'subscript' ? 0.14 : 0.08) < role.score) return null

        return {
          scriptRole,
          parentGroupId: bestEdge.fromId,
          score: promotedScore,
          evidence: [
            `${scriptRole === 'superscript' ? 'above-right' : 'below-right'}-sequence-fallback=1`,
            `sequence-context=${sequenceContext.id}`,
            `host-field=${getScriptFieldKind(scriptRole)}:${hostFieldSupport.supported ? (hostFieldSupport.fieldWeight === null ? 'legacy' : hostFieldSupport.fieldWeight.toFixed(2)) : 'relaxed-sequence'}`,
            `sequence-locality=${localityScore.toFixed(2)}`,
            ...claimSupport.evidence,
          ],
        }
      })
      .filter(Boolean)
      .sort((left, right) => (right?.score || 0) - (left?.score || 0))

    const bestCandidate = scriptCandidates[0]
    if (!bestCandidate) return role

    return makeRole(
      role.groupId,
      bestCandidate.scriptRole,
      bestCandidate.score,
      1,
      bestCandidate.parentGroupId,
      [
        ...role.evidence,
        'sequence-wide script fallback',
        ...bestCandidate.evidence,
        `parent-family=${roleMap.get(bestCandidate.parentGroupId)?.descriptor.family || 'expressionRoot'}`,
        `operator-kind=${getRoleDescriptor(bestCandidate.scriptRole).operatorKind}`,
        `operand-mode=${getRoleDescriptor(bestCandidate.scriptRole).operandReferenceMode}`,
        `operand-allows=${String(roleAllowsOperandRole(bestCandidate.scriptRole, roleMap.get(bestCandidate.parentGroupId)?.role || 'baseline'))}`,
        `parent-allows=${String(roleAllowsChildRole(roleMap.get(bestCandidate.parentGroupId)?.role || 'baseline', bestCandidate.scriptRole))}`,
        `ancestry=${getRoleDescriptor(bestCandidate.scriptRole).ancestry.join('>')}`,
      ],
      role.containerGroupIds,
    )
  })
}

const promoteRadicalWideScripts = (roles: StructuralRole[], contexts: ExpressionContext[], groups: StrokeGroup[]): StructuralRole[] => {
  const groupMap = new Map(groups.map((group) => [group.id, group]))

  return roles.map<StructuralRole>((role) => {
    if ((role.role !== 'superscript' && role.role !== 'subscript') || !role.parentGroupId) return role
    if (!isRadicalWideOutsideHostedMember(role.groupId, role.parentGroupId, contexts, groupMap)) return role

    const radicalContext = getRadicalWideContextForParentGroupId(role.parentGroupId, contexts)
    if (!radicalContext?.semanticRootGroupId) return role
    if (role.parentGroupId === radicalContext.semanticRootGroupId && role.associationContextId === radicalContext.id) return role

    const redirectedFromParentId = role.parentGroupId
    return {
      ...role,
      parentGroupId: radicalContext.semanticRootGroupId,
      associationContextId: radicalContext.id,
      normalizationAnchorGroupIds: uniqueIds(radicalContext.anchorGroupIds),
      evidence: [
        ...role.evidence.filter((entry) => !entry.startsWith('redirected-parent=')),
        'radical-wide script promotion',
        `redirected-parent=${redirectedFromParentId}->${radicalContext.semanticRootGroupId}`,
        `association-context=${radicalContext.id}`,
      ],
    }
  })
}

const promoteEnclosureWideScripts = (roles: StructuralRole[], contexts: ExpressionContext[], groups: StrokeGroup[]): StructuralRole[] => {
  const groupMap = new Map(groups.map((group) => [group.id, group]))

  return roles.map<StructuralRole>((role) => {
    if ((role.role !== 'superscript' && role.role !== 'subscript') || !role.parentGroupId) return role
    if (role.containerGroupIds.length > 0) return role
    if (!isEnclosureWideOutsideHostedMember(role.groupId, role.parentGroupId, contexts, groupMap)) return role

    const enclosureContext = getEnclosureWideContextForParentGroupId(role.parentGroupId, contexts)
    if (!enclosureContext?.semanticRootGroupId) return role
    if (role.parentGroupId === enclosureContext.semanticRootGroupId && role.associationContextId === enclosureContext.id) return role

    const redirectedFromParentId = role.parentGroupId
    return {
      ...role,
      parentGroupId: enclosureContext.semanticRootGroupId,
      associationContextId: enclosureContext.id,
      normalizationAnchorGroupIds: uniqueIds(enclosureContext.anchorGroupIds),
      evidence: [
        ...role.evidence.filter((entry) => !entry.startsWith('redirected-parent=')),
        'enclosure-wide script promotion',
        `redirected-parent=${redirectedFromParentId}->${enclosureContext.semanticRootGroupId}`,
        `association-context=${enclosureContext.id}`,
      ],
    }
  })
}

const forcePromoteRadicalWideScripts = (roles: StructuralRole[], radicalBindings: RadicalStructureBinding[], groups: StrokeGroup[]): StructuralRole[] => {
  const groupMap = new Map(groups.map((group) => [group.id, group]))

  return roles.map<StructuralRole>((role) => {
    const scriptGroup = groupMap.get(role.groupId)
    if (!scriptGroup) return role

    if ((role.role === 'superscript' || role.role === 'subscript') && role.parentGroupId) {
      const radicalBinding = getRadicalWideBindingForParentGroupId(role.parentGroupId, radicalBindings)
      const radicalBounds = radicalBinding ? getRadicalBindingBounds(radicalBinding, groupMap) : null
      if (!radicalBinding || !radicalBounds) return role
      if (scriptGroup.bounds.left < radicalBounds.right + Math.max(12, (radicalBounds.right - radicalBounds.left) * 0.06)) return role
      if (role.parentGroupId === radicalBinding.radicalGroupId && role.associationContextId === `context:radical:${radicalBinding.radicalGroupId}`) return role

      return {
        ...role,
        parentGroupId: radicalBinding.radicalGroupId,
        associationContextId: `context:radical:${radicalBinding.radicalGroupId}`,
        normalizationAnchorGroupIds: uniqueIds([radicalBinding.radicalGroupId, ...radicalBinding.radicandRootIds, ...radicalBinding.indexRootIds]),
        evidence: [
          ...role.evidence.filter((entry) => !entry.startsWith('redirected-parent=')),
          'radical-wide script promotion',
          `redirected-parent=${role.parentGroupId}->${radicalBinding.radicalGroupId}`,
          `association-context=context:radical:${radicalBinding.radicalGroupId}`,
        ],
      }
    }

    if (role.role !== 'baseline' || role.parentGroupId) return role

    const promotedCandidate = radicalBindings
      .map((binding) => {
        const radicalBounds = getRadicalBindingBounds(binding, groupMap)
        if (!radicalBounds) return null
        const radicalWidth = Math.max(1, radicalBounds.right - radicalBounds.left)
        const radicalHeight = Math.max(1, radicalBounds.bottom - radicalBounds.top)
        if (scriptGroup.bounds.left < radicalBounds.right + Math.max(10, radicalWidth * 0.05)) return null

        const horizontalGap = Math.max(0, scriptGroup.bounds.left - radicalBounds.right)
        const horizontalCloseness = clamp(1 - horizontalGap / Math.max(24, radicalWidth * 0.24), 0, 1)
        const superscriptTargetY = radicalBounds.top + radicalHeight * 0.08
        const subscriptTargetY = radicalBounds.bottom - radicalHeight * 0.08
        const superscriptVertical = clamp(1 - Math.abs(scriptGroup.bounds.bottom - superscriptTargetY) / Math.max(26, radicalHeight * 0.58), 0, 1)
        const subscriptVertical = clamp(1 - Math.abs(scriptGroup.bounds.top - subscriptTargetY) / Math.max(26, radicalHeight * 0.58), 0, 1)
        const superscriptScore = horizontalCloseness * 0.56 + superscriptVertical * 0.44
        const subscriptScore = horizontalCloseness * 0.56 + subscriptVertical * 0.44
        const roleKind: 'superscript' | 'subscript' = superscriptScore >= subscriptScore ? 'superscript' : 'subscript'
        const score = Math.max(superscriptScore, subscriptScore)
        if (score < 0.5) return null

        return {
          binding,
          roleKind,
          score,
        }
      })
      .filter(Boolean)
      .sort((left, right) => (right?.score || 0) - (left?.score || 0))[0] || null

    if (!promotedCandidate) return role

    return {
      ...role,
      role: promotedCandidate.roleKind,
      descriptor: getRoleDescriptor(promotedCandidate.roleKind),
      score: Math.max(role.score, 0.42 + promotedCandidate.score * 0.26),
      depth: 1,
      parentGroupId: promotedCandidate.binding.radicalGroupId,
      associationContextId: `context:radical:${promotedCandidate.binding.radicalGroupId}`,
      normalizationAnchorGroupIds: uniqueIds([promotedCandidate.binding.radicalGroupId, ...promotedCandidate.binding.radicandRootIds, ...promotedCandidate.binding.indexRootIds]),
      evidence: [
        ...role.evidence,
        'radical-wide script promotion',
        `association-context=context:radical:${promotedCandidate.binding.radicalGroupId}`,
        `promotion-role=${promotedCandidate.roleKind}`,
      ],
    }
  })
}

const ensureFractionSemanticRootsRemainBaseline = (roles: StructuralRole[], fractionBindings: FractionStructureBinding[], groups: StrokeGroup[]) => {
  const roleMap = new Map(roles.map((role) => [role.groupId, role]))
  const nextRoles = [...roles]
  const groupMap = new Map(groups.map((group) => [group.id, group]))

  for (const binding of fractionBindings) {
    for (const rootGroupId of [...binding.numeratorRootIds, ...binding.denominatorRootIds]) {
      if (!rootGroupId || !groupMap.has(rootGroupId)) continue
      const existing = roleMap.get(rootGroupId) || null
      if (existing && existing.role !== 'unsupportedSymbol') continue

      const replacement = makeRole(
        rootGroupId,
        'baseline',
        Math.max(existing?.score || 0, 0.68),
        0,
        null,
        [
          ...(existing?.evidence || []),
          'fraction-member semantic root remains a local baseline inside its hosted context',
          `family=${getRoleDescriptor('baseline').family}`,
        ],
        existing?.containerGroupIds || [],
        existing?.associationContextId || null,
        existing?.normalizationAnchorGroupIds || [rootGroupId],
      )

      if (existing) {
        const index = nextRoles.findIndex((role) => role.groupId === rootGroupId)
        if (index >= 0) nextRoles[index] = replacement
      } else {
        nextRoles.push(replacement)
      }
      roleMap.set(rootGroupId, replacement)
    }
  }

  return nextRoles
}

const isFractionWideOutsideMember = (groupId: string, parentRole: StructuralRole | null, groupMap: Map<string, StrokeGroup>) => {
  if (!parentRole?.parentGroupId) return false
  if (parentRole.role !== 'numerator' && parentRole.role !== 'denominator') return false
  const fractionBarGroup = groupMap.get(parentRole.parentGroupId)
  const scriptGroup = groupMap.get(groupId)
  if (!fractionBarGroup || !scriptGroup) return false
  return scriptGroup.bounds.left >= fractionBarGroup.bounds.right + Math.max(10, fractionBarGroup.bounds.width * 0.08)
}

const getRadicalWideBindingForParentGroupId = (
  parentGroupId: string | null | undefined,
  radicalBindings: RadicalStructureBinding[],
) => {
  if (!parentGroupId) return null
  return radicalBindings.find((binding) => binding.radicandRootIds.includes(parentGroupId) || binding.indexRootIds.includes(parentGroupId)) || null
}

const getRadicalBindingBounds = (binding: RadicalStructureBinding, groupMap: Map<string, StrokeGroup>) => {
  const groupIds = [binding.radicalGroupId, ...binding.radicandRootIds, ...binding.indexRootIds]
  const boundsList = groupIds
    .map((groupId) => groupMap.get(groupId)?.bounds)
    .filter(Boolean) as StrokeGroup['bounds'][]
  if (!boundsList.length) return null
  return mergeBounds(boundsList.map((bounds) => ({
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
    centerX: bounds.centerX,
    centerY: bounds.centerY,
  })))
}

const isRadicalWideOutsideMember = (
  groupId: string,
  parentGroupId: string | null | undefined,
  radicalBindings: RadicalStructureBinding[],
  groupMap: Map<string, StrokeGroup>,
) => {
  const binding = getRadicalWideBindingForParentGroupId(parentGroupId, radicalBindings)
  const radicalBounds = binding ? getRadicalBindingBounds(binding, groupMap) : null
  const scriptGroup = groupMap.get(groupId)
  if (!binding || !radicalBounds || !scriptGroup) return false
  return scriptGroup.bounds.left >= radicalBounds.right + Math.max(12, (radicalBounds.right - radicalBounds.left) * 0.06)
}

const isSameParentStackedScriptPair = (first: StrokeGroup, second: StrokeGroup) => {
  const upper = first.bounds.centerY <= second.bounds.centerY ? first : second
  const lower = upper.id === first.id ? second : first
  const overlapWidth = Math.max(0, Math.min(first.bounds.right, second.bounds.right) - Math.max(first.bounds.left, second.bounds.left))
  const minWidth = Math.max(1, Math.min(first.bounds.width, second.bounds.width))
  const sameColumn = overlapWidth / minWidth >= 0.14 || Math.abs(first.bounds.centerX - second.bounds.centerX) <= Math.max(22, (first.bounds.width + second.bounds.width) * 0.42)
  const clearlySeparatedRows = lower.bounds.centerY - upper.bounds.centerY >= Math.max(16, (first.bounds.height + second.bounds.height) * 0.38)
  return sameColumn && clearlySeparatedRows
}

const collectStableAttachments = (
  groups: StrokeGroup[],
  edges: LayoutEdge[],
  blockedGroupIds: Set<string>,
  topBrickHypothesisByGroupId: Map<string, LegoBrickHypothesis>,
  fieldClaimsByTargetGroupId: Map<string, LegoFieldClaim[]>,
) => {
  const attachments: StableAttachment[] = []
  const groupIds = new Set(groups.map((group) => group.id))
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const fractionBarrierGroups = groups.filter((group) => topBrickHypothesisByGroupId.get(group.id)?.family === 'fractionBarBrick')
  const radicalBarrierGroups = groups.filter((group) => topBrickHypothesisByGroupId.get(group.id)?.family === 'radicalBrick')

  for (const group of groups) {
    if (blockedGroupIds.has(group.id)) continue
    const bestSuperEntry = findBestAdmissibleScriptEdge(incomingByKind(edges, group.id, 'superscriptCandidate'), 'superscript', groupMap, topBrickHypothesisByGroupId, fieldClaimsByTargetGroupId, fractionBarrierGroups, radicalBarrierGroups)
    const bestSubEntry = findBestAdmissibleScriptEdge(incomingByKind(edges, group.id, 'subscriptCandidate'), 'subscript', groupMap, topBrickHypothesisByGroupId, fieldClaimsByTargetGroupId, fractionBarrierGroups, radicalBarrierGroups)
    const bestSuper = bestSuperEntry?.edge || null
    const bestSub = bestSubEntry?.edge || null
    const bestSequence = incomingByKind(edges, group.id, 'sequence')[0] || null

    const candidates = [
      bestSuper && bestSuperEntry ? { edge: bestSuper, role: 'superscript' as const, score: bestSuperEntry.adjustedScore } : null,
      bestSub && bestSubEntry ? { edge: bestSub, role: 'subscript' as const, score: bestSubEntry.adjustedScore } : null,
    ]
      .filter(Boolean)
      .sort((left, right) => (right?.score || 0) - (left?.score || 0))

    const best = candidates[0]
    if (!best) continue
    if (!groupIds.has(best.edge.fromId) || !groupIds.has(best.edge.toId)) continue
    if (blockedGroupIds.has(best.edge.fromId) || blockedGroupIds.has(best.edge.toId)) continue
    const sequenceScore = bestSequence?.score || 0
    if ((best.score || 0) < 0.42) continue
    if (sequenceScore > 0 && (best.score || 0) - sequenceScore < 0.08) continue

    attachments.push({
      parentId: best.edge.fromId,
      childId: best.edge.toId,
      role: best.role,
      score: best.score || best.edge.score,
    })
  }

  const childOwners = new Set<string>()
  const resolved: StableAttachment[] = []
  for (const attachment of attachments.sort((left, right) => right.score - left.score)) {
    if (childOwners.has(attachment.childId)) continue
    childOwners.add(attachment.childId)
    resolved.push(attachment)
  }

  const attachmentByChildId = new Map(resolved.map((attachment) => [attachment.childId, attachment]))
  return resolved.filter((attachment) => {
    const parentAttachment = attachmentByChildId.get(attachment.parentId) || null
    if (!parentAttachment) return true
    return parentAttachment.role === attachment.role
  })
}

const buildLocalSubexpressions = (groups: StrokeGroup[], attachments: StableAttachment[], blockedGroupIds: Set<string>) => {
  const parentToChildren = new Map<string, StableAttachment[]>()
  const childToParent = new Map<string, StableAttachment>()
  const groupMap = new Map(groups.map((group) => [group.id, group]))

  for (const attachment of attachments) {
    if (!parentToChildren.has(attachment.parentId)) {
      parentToChildren.set(attachment.parentId, [])
    }
    parentToChildren.get(attachment.parentId)?.push(attachment)
    childToParent.set(attachment.childId, attachment)
  }

  const roots = groups
    .filter((group) => !blockedGroupIds.has(group.id))
    .filter((group) => !childToParent.has(group.id))
    .sort((left, right) => left.bounds.left - right.bounds.left)

  const subexpressions: LocalSubexpression[] = []
  const rootClaims = new Map<string, RootClaim>()

  const collectMembers = (rootId: string) => {
    const memberGroupIds: string[] = []
    const attachmentList: LocalSubexpression['attachments'] = []
    const stack = [rootId]
    while (stack.length) {
      const currentId = stack.pop() as string
      memberGroupIds.push(currentId)
      const children = parentToChildren.get(currentId) || []
      for (const child of children) {
        attachmentList.push({
          parentGroupId: child.parentId,
          childGroupId: child.childId,
          role: child.role,
          score: child.score,
        })
        stack.push(child.childId)
      }
    }
    memberGroupIds.sort((left, right) => (groupMap.get(left)?.bounds.left || 0) - (groupMap.get(right)?.bounds.left || 0))
    return { memberGroupIds, attachmentList }
  }

  for (const root of roots) {
    const { memberGroupIds, attachmentList } = collectMembers(root.id)
    rootClaims.set(root.id, { rootGroupId: root.id, role: 'baseline' })
    subexpressions.push({
      rootGroupId: root.id,
      memberGroupIds,
      attachments: attachmentList,
      rootRole: 'baseline',
    })
  }

  return { subexpressions, rootClaims }
}

const getSubexpressionBounds = (subexpression: LocalSubexpression, groupMap: Map<string, StrokeGroup>) => {
  const members = subexpression.memberGroupIds.map((groupId) => groupMap.get(groupId)).filter(Boolean) as StrokeGroup[]
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const member of members) {
    if (member.bounds.left < left) left = member.bounds.left
    if (member.bounds.top < top) top = member.bounds.top
    if (member.bounds.right > right) right = member.bounds.right
    if (member.bounds.bottom > bottom) bottom = member.bounds.bottom
  }
  return {
    left,
    top,
    right,
    bottom,
    centerX: left + (right - left) / 2,
    centerY: top + (bottom - top) / 2,
  }
}

const mergeBounds = (boundsList: Array<ReturnType<typeof getSubexpressionBounds>>) => {
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const bounds of boundsList) {
    if (bounds.left < left) left = bounds.left
    if (bounds.top < top) top = bounds.top
    if (bounds.right > right) right = bounds.right
    if (bounds.bottom > bottom) bottom = bounds.bottom
  }
  return {
    left,
    top,
    right,
    bottom,
    centerX: left + (right - left) / 2,
    centerY: top + (bottom - top) / 2,
  }
}

const getWidthComparability = (referenceWidth: number, candidateWidth: number) => {
  const ratio = Math.max(referenceWidth, 1) / Math.max(candidateWidth, 1)
  if (ratio < 0.75) return clamp(ratio / 0.75, 0, 1)
  if (ratio <= 1.95) return 1
  return clamp(1 - (ratio - 1.95) / 1.4, 0, 1)
}

const scoreFractionMemberAlignment = (bar: StrokeGroup, memberBounds: ReturnType<typeof getSubexpressionBounds>) => {
  const centeredScore = clamp(1 - Math.abs(memberBounds.centerX - bar.bounds.centerX) / Math.max(24, bar.bounds.width * 0.38), 0, 1)
  const widthScore = getWidthComparability(bar.bounds.width, memberBounds.right - memberBounds.left)
  const overlapScore = clamp(Math.min(bar.bounds.right, memberBounds.right) - Math.max(bar.bounds.left, memberBounds.left), 0, bar.bounds.width) / Math.max(1, bar.bounds.width)
  return {
    centeredScore,
    widthScore,
    overlapScore,
    score: centeredScore * 0.5 + widthScore * 0.28 + overlapScore * 0.22,
  }
}

const getFractionSideFieldFitScore = (
  bar: StrokeGroup,
  memberBounds: ReturnType<typeof getSubexpressionBounds>,
  side: 'numerator' | 'denominator',
) => {
  const verticalGap = side === 'numerator'
    ? Math.max(0, bar.bounds.top - memberBounds.bottom)
    : Math.max(0, memberBounds.top - bar.bounds.bottom)
  const wrongSideIntrusion = side === 'numerator'
    ? Math.max(0, memberBounds.bottom - bar.bounds.centerY)
    : Math.max(0, bar.bounds.centerY - memberBounds.top)
  const gapScore = clamp(1 - verticalGap / Math.max(44, bar.bounds.height * 7.5), 0, 1)
  const sidePurityScore = clamp(1 - wrongSideIntrusion / Math.max(24, bar.bounds.height * 2.6), 0, 1)
  const fieldReachScore = clamp(1 - Math.abs(memberBounds.centerX - bar.bounds.centerX) / Math.max(32, bar.bounds.width * 0.9), 0, 1)
  return gapScore * 0.42 + sidePurityScore * 0.26 + fieldReachScore * 0.32
}

const getCandidateClarityScore = <T>(candidates: T[], getScore: (candidate: T) => number) => {
  const orderedScores = candidates.map(getScore).sort((left, right) => right - left)
  const topScore = orderedScores[0] || 0
  const runnerUpScore = orderedScores[1] || 0
  if (topScore <= 0) return 0
  return clamp((topScore - runnerUpScore) / Math.max(0.12, topScore), 0, 1)
}

const getFractionSideCandidates = (
  bar: StrokeGroup,
  subexpressions: LocalSubexpression[],
  groupMap: Map<string, StrokeGroup>,
  fieldClaimsByTargetGroupId: Map<string, LegoFieldClaim[]>,
  side: 'numerator' | 'denominator',
  shapeScore: number,
) => {
  const strongStructuralSearch = shapeScore >= 0.72
  const relaxedCenteredThreshold = strongStructuralSearch ? 0.12 : 0.22
  const relaxedAlignmentThreshold = strongStructuralSearch ? 0.22 : 0.3
  const relaxedFieldHalfWidth = bar.bounds.width * (strongStructuralSearch ? 0.86 : 0.62)

  return subexpressions
    .map((subexpression) => ({ subexpression, bounds: getSubexpressionBounds(subexpression, groupMap) }))
    .filter(({ bounds }) => side === 'numerator'
      ? bounds.bottom <= bar.bounds.top + 24
      : bounds.top >= bar.bounds.bottom - 12)
    .map(({ subexpression, bounds }) => {
      const alignment = scoreFractionMemberAlignment(bar, bounds)
      const fieldFitScore = getFractionSideFieldFitScore(bar, bounds, side)
      const hostedClaimSupport = getSubexpressionFieldClaimSupport(subexpression, fieldClaimsByTargetGroupId, bar.id, side === 'numerator' ? 'over' : 'under')
      const occupantBeliefScore = clamp(alignment.score * 0.42 + fieldFitScore * 0.22 + hostedClaimSupport.score * 0.24 + alignment.centeredScore * 0.12, 0, 1)
      const hostMutualReinforcementScore = clamp(Math.sqrt(Math.max(shapeScore, 0) * Math.max(occupantBeliefScore, 0)), 0, 1)
      const sideConsistencyScore = clamp(occupantBeliefScore * 0.5 + hostMutualReinforcementScore * 0.34 + hostedClaimSupport.score * 0.16, 0, 1)
      return {
        subexpression,
        bounds,
        alignment,
        fieldFitScore,
        hostedClaimScore: hostedClaimSupport.score,
        occupantBeliefScore,
        hostMutualReinforcementScore,
        sideConsistencyScore,
      }
    })
    .filter(({ bounds, alignment }) => {
      const centeredOrOverlapping = alignment.centeredScore >= relaxedCenteredThreshold
        || alignment.overlapScore >= clamp(Math.min(0.46, bar.bounds.width > 0 ? Math.max(0.12, 16 / bar.bounds.width) : 0.12), 0.12, 0.46)

      if (centeredOrOverlapping) return true

      const fieldAligned = Math.abs(bounds.centerX - bar.bounds.centerX) <= Math.max(26, relaxedFieldHalfWidth)
      return strongStructuralSearch && fieldAligned && alignment.score >= relaxedAlignmentThreshold
    })
    .sort((left, right) => right.sideConsistencyScore - left.sideConsistencyScore || left.bounds.left - right.bounds.left)
}

const scoreFractionHypothesis = (bar: StrokeGroup, numerator: FractionSideCandidate, denominator: FractionSideCandidate, shapeScore: number): FractionHypothesis => {
  const axisConsistency = clamp(1 - Math.abs(numerator.bounds.centerX - denominator.bounds.centerX) / Math.max(24, bar.bounds.width * 0.42), 0, 1)
  const numeratorWidth = Math.max(1, numerator.bounds.right - numerator.bounds.left)
  const denominatorWidth = Math.max(1, denominator.bounds.right - denominator.bounds.left)
  const memberWidthHarmony = clamp(1 - Math.abs(numeratorWidth - denominatorWidth) / Math.max(28, Math.max(numeratorWidth, denominatorWidth) * 0.85), 0, 1)
  const numeratorGap = Math.max(0, bar.bounds.top - numerator.bounds.bottom)
  const denominatorGap = Math.max(0, denominator.bounds.top - bar.bounds.bottom)
  const verticalSymmetry = clamp(1 - Math.abs(numeratorGap - denominatorGap) / Math.max(28, bar.bounds.height * 6), 0, 1)
  const occupantMutualScore = clamp(
    Math.sqrt(Math.max(numerator.sideConsistencyScore, 0) * Math.max(denominator.sideConsistencyScore, 0)) * 0.58
      + ((numerator.occupantBeliefScore + denominator.occupantBeliefScore) / 2) * 0.42,
    0,
    1,
  )
  const hostBeliefScore = clamp(
    shapeScore * 0.36
      + Math.sqrt(Math.max(numerator.hostMutualReinforcementScore, 0) * Math.max(denominator.hostMutualReinforcementScore, 0)) * 0.4
      + ((numerator.fieldFitScore + denominator.fieldFitScore) / 2) * 0.14
      + ((numerator.hostedClaimScore + denominator.hostedClaimScore) / 2) * 0.1,
    0,
    1,
  )
  const localCoherenceScore = clamp(
    axisConsistency * 0.3
      + memberWidthHarmony * 0.18
      + verticalSymmetry * 0.18
      + numerator.fieldFitScore * 0.12
      + denominator.fieldFitScore * 0.12
      + numerator.hostedClaimScore * 0.1
      + denominator.hostedClaimScore * 0.1,
    0,
    1,
  )
  const globalCompatibilityScore = clamp(
    localCoherenceScore * 0.46
      + occupantMutualScore * 0.28
      + hostBeliefScore * 0.18
      + (numerator.subexpression.rootGroupId !== denominator.subexpression.rootGroupId ? 0.08 : 0),
    0,
    1,
  )
  const score = clamp(
    occupantMutualScore * 0.34
      + hostBeliefScore * 0.24
      + localCoherenceScore * 0.24
      + globalCompatibilityScore * 0.18,
    0,
    1,
  )

  return {
    numerator,
    denominator,
    score,
    axisConsistency,
    memberWidthHarmony,
    hostBeliefScore,
    occupantMutualScore,
    localCoherenceScore,
    globalCompatibilityScore,
  }
}

const scoreFractionContext = (
  bar: StrokeGroup,
  subexpressions: LocalSubexpression[],
  groupMap: Map<string, StrokeGroup>,
  fieldClaimsByTargetGroupId: Map<string, LegoFieldClaim[]>,
): ScoredFractionContext => {
  const shapeScore = getFractionBarShapeScore(bar)
  const barLocality = getRoleLocalityBias('fractionBar')
  const numeratorCandidates = getFractionSideCandidates(bar, subexpressions, groupMap, fieldClaimsByTargetGroupId, 'numerator', shapeScore)
  const denominatorCandidates = getFractionSideCandidates(bar, subexpressions, groupMap, fieldClaimsByTargetGroupId, 'denominator', shapeScore)

  const numeratorBounds = numeratorCandidates.length ? mergeBounds(numeratorCandidates.map((candidate) => candidate.bounds)) : null
  const denominatorBounds = denominatorCandidates.length ? mergeBounds(denominatorCandidates.map((candidate) => candidate.bounds)) : null
  const numeratorAggregate = numeratorBounds ? scoreFractionMemberAlignment(bar, numeratorBounds) : null
  const denominatorAggregate = denominatorBounds ? scoreFractionMemberAlignment(bar, denominatorBounds) : null
  const hypotheses = numeratorCandidates.flatMap((numerator) => denominatorCandidates.map((denominator) => scoreFractionHypothesis(bar, numerator, denominator, shapeScore)))
  const bestHypothesis = hypotheses.sort((left, right) => right.score - left.score)[0] || null
  const numeratorClarityScore = getCandidateClarityScore(numeratorCandidates, (candidate) => candidate.sideConsistencyScore)
  const denominatorClarityScore = getCandidateClarityScore(denominatorCandidates, (candidate) => candidate.sideConsistencyScore)
  const hypothesisClarityScore = getCandidateClarityScore(hypotheses, (candidate) => candidate.score)
  const legacyBarRecognitionScore = numeratorAggregate
    ? shapeScore * 0.32 + numeratorAggregate.centeredScore * 0.36 + numeratorAggregate.widthScore * 0.2 + numeratorAggregate.overlapScore * 0.12
    : 0
  const legacyMemberClaimScore = numeratorAggregate && denominatorAggregate
    ? shapeScore * 0.18 + numeratorAggregate.centeredScore * 0.32 * barLocality.local + denominatorAggregate.centeredScore * 0.22 * barLocality.adjacent + numeratorAggregate.widthScore * 0.18 + denominatorAggregate.overlapScore * 0.1
    : 0
  const provisionalNumeratorScore = numeratorCandidates[0]
    ? clamp(
      shapeScore * 0.22
        + numeratorCandidates[0].occupantBeliefScore * 0.4
        + numeratorCandidates[0].hostMutualReinforcementScore * 0.28
        + numeratorClarityScore * 0.1,
      0,
      1,
    )
    : 0
  const provisionalDenominatorScore = denominatorCandidates[0]
    ? clamp(
      shapeScore * 0.22
        + denominatorCandidates[0].occupantBeliefScore * 0.4
        + denominatorCandidates[0].hostMutualReinforcementScore * 0.28
        + denominatorClarityScore * 0.1,
      0,
      1,
    )
    : 0
  const mutualReinforcementScore = bestHypothesis
    ? clamp(bestHypothesis.occupantMutualScore * 0.58 + bestHypothesis.hostBeliefScore * 0.42, 0, 1)
    : Math.max(
      numeratorCandidates[0]?.hostMutualReinforcementScore || 0,
      denominatorCandidates[0]?.hostMutualReinforcementScore || 0,
    )
  const localCoherenceScore = bestHypothesis?.localCoherenceScore || 0
  const globalCompatibilityScore = bestHypothesis?.globalCompatibilityScore || 0
  const revisionPressureScore = clamp(
    (1 - numeratorClarityScore) * 0.28
      + (1 - denominatorClarityScore) * 0.28
      + (1 - hypothesisClarityScore) * 0.28
      + (bestHypothesis ? (1 - bestHypothesis.globalCompatibilityScore) * 0.16 : 0.16),
    0,
    1,
  )
  const jointBarRecognitionScore = bestHypothesis
    ? clamp(
      shapeScore * 0.16
        + mutualReinforcementScore * 0.32
        + localCoherenceScore * 0.22
        + globalCompatibilityScore * 0.22
        + hypothesisClarityScore * 0.14
        - revisionPressureScore * 0.06,
      0,
      1,
    )
    : Math.max(provisionalNumeratorScore, provisionalDenominatorScore)
  const jointMemberClaimScore = bestHypothesis
    ? clamp(
      mutualReinforcementScore * 0.34
        + localCoherenceScore * 0.24
        + globalCompatibilityScore * 0.2
        + hypothesisClarityScore * 0.12
        + shapeScore * 0.1
        - revisionPressureScore * 0.04,
      0,
      1,
    )
    : 0
  const barRecognitionScore = Math.max(legacyBarRecognitionScore, jointBarRecognitionScore)
  const memberClaimScore = Math.max(legacyMemberClaimScore, jointMemberClaimScore)

  return {
    shapeScore,
    numeratorRoots: numeratorCandidates.map((candidate) => candidate.subexpression),
    denominatorRoots: denominatorCandidates.map((candidate) => candidate.subexpression),
    numeratorAggregate,
    denominatorAggregate,
    barRecognitionScore,
    memberClaimScore,
    bestHypothesis,
    provisionalNumeratorScore,
    provisionalDenominatorScore,
    mutualReinforcementScore,
    localCoherenceScore,
    globalCompatibilityScore,
    revisionPressureScore,
    preferredNumeratorRootId: bestHypothesis?.numerator.subexpression.rootGroupId || null,
    preferredDenominatorRootId: bestHypothesis?.denominator.subexpression.rootGroupId || null,
    evidence: [
      `shapeScore=${shapeScore.toFixed(3)}`,
      `barRecognitionScore=${barRecognitionScore.toFixed(3)}`,
      `memberClaimScore=${memberClaimScore.toFixed(3)}`,
      bestHypothesis ? `bestHypothesisScore=${bestHypothesis.score.toFixed(3)}` : 'noBestHypothesis',
      `provisionalNumeratorScore=${provisionalNumeratorScore.toFixed(3)}`,
      `provisionalDenominatorScore=${provisionalDenominatorScore.toFixed(3)}`,
      `mutualReinforcementScore=${mutualReinforcementScore.toFixed(3)}`,
      `localCoherenceScore=${localCoherenceScore.toFixed(3)}`,
      `globalCompatibilityScore=${globalCompatibilityScore.toFixed(3)}`,
      `revisionPressureScore=${revisionPressureScore.toFixed(3)}`,
      bestHypothesis ? `hostBeliefScore=${bestHypothesis.hostBeliefScore.toFixed(3)}` : undefined,
      bestHypothesis ? `occupantMutualScore=${bestHypothesis.occupantMutualScore.toFixed(3)}` : undefined,
    ].filter(Boolean) as string[],
  }
}

const getRadicalInteriorCandidates = (
  radical: StrokeGroup,
  subexpressions: LocalSubexpression[],
  groupMap: Map<string, StrokeGroup>,
  fieldClaimsByTargetGroupId: Map<string, LegoFieldClaim[]>,
) => {
  const targetLeft = radical.bounds.left + Math.max(14, radical.bounds.width * 0.22)
  const targetRight = radical.bounds.right + Math.max(18, radical.bounds.width * 0.14)
  const targetTop = radical.bounds.top - Math.max(8, radical.bounds.height * 0.06)
  const targetBottom = radical.bounds.bottom - Math.max(4, radical.bounds.height * 0.12)

  return subexpressions
    .filter((subexpression) => subexpression.rootGroupId !== radical.id)
    .map((subexpression) => ({ subexpression, bounds: getSubexpressionBounds(subexpression, groupMap) }))
    .filter(({ bounds }) => bounds.centerX >= radical.bounds.left + radical.bounds.width * 0.18 && bounds.bottom >= radical.bounds.top + radical.bounds.height * 0.16)
    .map(({ subexpression, bounds }) => {
      const hostedClaimSupport = getSubexpressionFieldClaimSupport(subexpression, fieldClaimsByTargetGroupId, radical.id, 'interior')
      const width = Math.max(1, bounds.right - bounds.left)
      const height = Math.max(1, bounds.bottom - bounds.top)
      const horizontalOverlap = clamp(Math.min(bounds.right, targetRight) - Math.max(bounds.left, targetLeft), 0, width) / width
      const verticalOverlap = clamp(Math.min(bounds.bottom, targetBottom) - Math.max(bounds.top, targetTop), 0, height) / height
      const leftProgress = clamp((bounds.left - (radical.bounds.left + radical.bounds.width * 0.12)) / Math.max(24, radical.bounds.width * 0.5), 0, 1)
      const rightPenalty = clamp(1 - Math.max(bounds.left - (radical.bounds.right + radical.bounds.width * 0.2), 0) / Math.max(28, radical.bounds.width * 0.3), 0, 1)
      const score = horizontalOverlap * 0.3 + verticalOverlap * 0.2 + leftProgress * 0.14 + rightPenalty * 0.18 + hostedClaimSupport.score * 0.18
      return { subexpression, bounds, score }
    })
    .filter(({ score }) => score >= 0.42)
    .sort((left, right) => right.score - left.score || left.bounds.left - right.bounds.left)
}

const getRadicalIndexCandidates = (
  radical: StrokeGroup,
  subexpressions: LocalSubexpression[],
  groupMap: Map<string, StrokeGroup>,
  fieldClaimsByTargetGroupId: Map<string, LegoFieldClaim[]>,
  excludedRootIds: Set<string>,
) => {
  const targetX = radical.bounds.left - Math.max(18, radical.bounds.width * 0.34)
  const targetY = radical.bounds.top - Math.max(10, radical.bounds.height * 0.18)

  return subexpressions
    .filter((subexpression) => subexpression.rootGroupId !== radical.id && !excludedRootIds.has(subexpression.rootGroupId))
    .map((subexpression) => ({ subexpression, bounds: getSubexpressionBounds(subexpression, groupMap) }))
    .filter(({ bounds }) => bounds.right <= radical.bounds.left + radical.bounds.width * 0.14 && bounds.bottom <= radical.bounds.top + radical.bounds.height * 0.12)
    .map(({ subexpression, bounds }) => {
      const hostedClaimSupport = getSubexpressionFieldClaimSupport(subexpression, fieldClaimsByTargetGroupId, radical.id, 'upperLeftScript')
      const horizontalCloseness = clamp(1 - Math.abs(bounds.centerX - targetX) / Math.max(22, radical.bounds.width * 0.42), 0, 1)
      const verticalCloseness = clamp(1 - Math.abs(bounds.centerY - targetY) / Math.max(20, radical.bounds.height * 0.34), 0, 1)
      const sizeScore = clamp(1 - Math.max((bounds.right - bounds.left) - radical.bounds.width * 0.42, 0) / Math.max(18, radical.bounds.width * 0.24), 0, 1)
      const score = horizontalCloseness * 0.34 + verticalCloseness * 0.32 + sizeScore * 0.14 + hostedClaimSupport.score * 0.2
      return { subexpression, bounds, score }
    })
    .filter(({ score }) => score >= 0.44)
    .sort((left, right) => right.score - left.score || left.bounds.left - right.bounds.left)
}

const scoreRadicalContext = (
  radical: StrokeGroup,
  subexpressions: LocalSubexpression[],
  groupMap: Map<string, StrokeGroup>,
  fieldClaimsByTargetGroupId: Map<string, LegoFieldClaim[]>,
) => {
  const radicandCandidates = getRadicalInteriorCandidates(radical, subexpressions, groupMap, fieldClaimsByTargetGroupId)
  const indexCandidates = getRadicalIndexCandidates(radical, subexpressions, groupMap, fieldClaimsByTargetGroupId, new Set(radicandCandidates.map((candidate) => candidate.subexpression.rootGroupId)))
  const radicandRoots = getOrderedRootIds(radicandCandidates.map((candidate) => candidate.subexpression.rootGroupId), groupMap)
  const indexRoots = getOrderedRootIds(indexCandidates.map((candidate) => candidate.subexpression.rootGroupId), groupMap)

  return {
    radicandRoots,
    indexRoots,
    radicandScore: radicandCandidates[0]?.score || 0,
    indexScore: indexCandidates[0]?.score || 0,
    preferredRadicandRootId: radicandCandidates[0]?.subexpression.rootGroupId || null,
    preferredIndexRootId: indexCandidates[0]?.subexpression.rootGroupId || null,
  }
}

const isEnclosureBoundaryCandidate = (group: StrokeGroup) => {
  const tallEnough = group.bounds.height >= 56
  const narrowEnough = group.bounds.width <= Math.max(34, group.bounds.height * 0.68)
  return tallEnough && narrowEnough && group.aspectRatio <= 0.75 && group.bounds.width > 6
}

const getEnclosureSemanticRootId = (
  enclosure: EnclosureStructure & { memberGroupIds: string[] },
  boundaryGroupId: string,
  groupMap: Map<string, StrokeGroup>,
) => {
  const roots = enclosure.memberRootIds
    .map((groupId) => groupMap.get(groupId))
    .filter(Boolean) as StrokeGroup[]
  if (!roots.length) return null
  if (boundaryGroupId === enclosure.closeGroupId) {
    return roots.sort((left, right) => right.bounds.right - left.bounds.right)[0]?.id || null
  }
  return roots.sort((left, right) => left.bounds.left - right.bounds.left)[0]?.id || null
}

const detectEnclosures = (candidateBoundaryGroups: StrokeGroup[], subexpressions: LocalSubexpression[], groupMap: Map<string, StrokeGroup>, blockedGroupIds: Set<string>) => {
  const candidates = candidateBoundaryGroups
    .filter((group) => !blockedGroupIds.has(group.id))
    .sort((left, right) => left.bounds.left - right.bounds.left)

  const rootsWithBounds = subexpressions.map((subexpression) => ({
    subexpression,
    bounds: getSubexpressionBounds(subexpression, groupMap),
  }))

  const scoredPairs: Array<EnclosureStructure & { memberGroupIds: string[] }> = []
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const open = candidates[leftIndex]
      const close = candidates[rightIndex]
      const members = rootsWithBounds.filter(({ bounds }) => {
        const insideHorizontally = bounds.left >= open.bounds.right - 10 && bounds.right <= close.bounds.left + 10
        const verticallyCovered = bounds.top >= Math.min(open.bounds.top, close.bounds.top) - 22 && bounds.bottom <= Math.max(open.bounds.bottom, close.bounds.bottom) + 22
        return insideHorizontally && verticallyCovered
      })
      if (!members.length) continue

      const contentBounds = mergeBounds(members.map((member) => member.bounds))
      const leftGap = contentBounds.left - open.bounds.right
      const rightGap = close.bounds.left - contentBounds.right
      if (leftGap < -10 || rightGap < -10) continue

      const heightSimilarity = clamp(1 - Math.abs(open.bounds.height - close.bounds.height) / Math.max(open.bounds.height, close.bounds.height, 1), 0, 1)
      const verticalAlignment = clamp(1 - Math.abs(open.bounds.centerY - close.bounds.centerY) / Math.max(24, Math.max(open.bounds.height, close.bounds.height) * 0.45), 0, 1)
      const contentCoverage = clamp(Math.min(open.bounds.bottom, close.bounds.bottom) - Math.max(open.bounds.top, close.bounds.top), 0, contentBounds.bottom - contentBounds.top + 24) / Math.max(24, contentBounds.bottom - contentBounds.top + 24)
      const innerSpacing = clamp(1 - (Math.max(leftGap, 0) + Math.max(rightGap, 0)) / Math.max(40, contentBounds.right - contentBounds.left + 40), 0, 1)
      const score = heightSimilarity * 0.26 + verticalAlignment * 0.24 + contentCoverage * 0.24 + innerSpacing * 0.26
      if (score < 0.64) continue

      const memberRootIds = members.map((member) => member.subexpression.rootGroupId)
      const memberGroupIds = members.flatMap((member) => member.subexpression.memberGroupIds)
      scoredPairs.push({
        id: `enclosure:${open.id}:${close.id}`,
        kind: 'parentheses',
        openGroupId: open.id,
        closeGroupId: close.id,
        memberRootIds,
        memberGroupIds,
        score,
      })
    }
  }

  const usedBoundaryIds = new Set<string>()
  const usedMemberIds = new Set<string>()
  const resolved: Array<EnclosureStructure & { memberGroupIds: string[] }> = []
  for (const pair of scoredPairs.sort((left, right) => right.score - left.score)) {
    if (usedBoundaryIds.has(pair.openGroupId) || usedBoundaryIds.has(pair.closeGroupId)) continue
    if (pair.memberRootIds.some((memberId) => usedMemberIds.has(memberId))) continue
    usedBoundaryIds.add(pair.openGroupId)
    usedBoundaryIds.add(pair.closeGroupId)
    for (const memberId of pair.memberRootIds) {
      usedMemberIds.add(memberId)
    }
    resolved.push(pair)
  }

  return resolved
}

const getRoleContextKey = (role: StructuralRole) => {
  const containers = [...role.containerGroupIds].sort().join(',') || 'root'
  return `parent:${role.parentGroupId || 'none'}|containers:${containers}`
}

const getScriptContextKey = (role: StructuralRole) => {
  const containers = [...role.containerGroupIds].sort().join(',') || 'root'
  return `role:${role.role}|parent:${role.parentGroupId || 'none'}|containers:${containers}`
}

const makeUnsupportedRole = (role: StructuralRole, evidence: string[]) => makeRole(
  role.groupId,
  'unsupportedSymbol',
  Math.max(role.score, 0.62),
  0,
  null,
  [
    ...role.evidence,
    ...evidence,
    `family=${getRoleDescriptor('unsupportedSymbol').family}`,
  ],
  role.containerGroupIds,
  role.associationContextId,
  role.normalizationAnchorGroupIds,
)

const uniqueIds = (values: string[]) => Array.from(new Set(values.filter(Boolean)))

const getOrderedRootIds = (rootIds: string[], groupMap: Map<string, StrokeGroup>) => {
  return uniqueIds(rootIds).sort((left, right) => {
    const leftGroup = groupMap.get(left)
    const rightGroup = groupMap.get(right)
    const leftX = leftGroup?.bounds.left || 0
    const rightX = rightGroup?.bounds.left || 0
    if (leftX !== rightX) return leftX - rightX
    return left.localeCompare(right)
  })
}

const prioritizeRootId = (rootIds: string[], preferredRootId: string | null, groupMap: Map<string, StrokeGroup>) => {
  const ordered = getOrderedRootIds(rootIds, groupMap)
  if (!preferredRootId || !ordered.includes(preferredRootId)) return ordered
  return [preferredRootId, ...ordered.filter((rootId) => rootId !== preferredRootId)]
}

const buildSequenceContexts = (
  roles: StructuralRole[],
  subexpressions: LocalSubexpression[],
  groupMap: Map<string, StrokeGroup>,
  parentContextId: string,
  containerGroupIds: string[],
  edges: LayoutEdge[],
  brickHypothesesByGroupId: Map<string, LegoBrickHypothesis[]>,
  topBrickHypothesisByGroupId: Map<string, LegoBrickHypothesis>,
) => {
  const roleMap = new Map(roles.map((role) => [role.groupId, role]))
  const candidates = subexpressions
    .filter((subexpression) => subexpression.rootRole === 'baseline')
    .map((subexpression) => ({
      subexpression,
      role: roleMap.get(subexpression.rootGroupId) || null,
      bounds: getSubexpressionBounds(subexpression, groupMap),
    }))
    .filter(({ role }) => role?.role === 'baseline' && role.parentGroupId == null)
    .filter(({ role }) => [...(role?.containerGroupIds || [])].sort().join(',') === [...containerGroupIds].sort().join(','))
    .sort((left, right) => left.bounds.left - right.bounds.left)

  const clusters: Array<typeof candidates> = []
  let currentCluster: Array<typeof candidates[number]> = []

  for (const candidate of candidates) {
    const previous = currentCluster[currentCluster.length - 1]
    if (!previous) {
      currentCluster.push(candidate)
      continue
    }

    const horizontalGap = candidate.bounds.left - previous.bounds.right
    const verticalOffset = Math.abs(candidate.bounds.centerY - previous.bounds.centerY)
    const compatibleGap = horizontalGap <= Math.max(44, Math.max(previous.bounds.right - previous.bounds.left, candidate.bounds.right - candidate.bounds.left) * 0.9)
    const compatibleBaseline = verticalOffset <= Math.max(28, Math.max(previous.bounds.bottom - previous.bounds.top, candidate.bounds.bottom - candidate.bounds.top) * 0.55)
    const inlineSupport = getInlineAffordanceScore(brickHypothesesByGroupId, previous.subexpression.rootGroupId, candidate.subexpression.rootGroupId)
    const previousAllowsSequence = sequenceContextAllowsRoot(topBrickHypothesisByGroupId, previous.subexpression.rootGroupId)
    const candidateAllowsSequence = sequenceContextAllowsRoot(topBrickHypothesisByGroupId, candidate.subexpression.rootGroupId)

    if (compatibleGap && compatibleBaseline && previousAllowsSequence && candidateAllowsSequence && inlineSupport.supported) {
      currentCluster.push(candidate)
      continue
    }

    if (currentCluster.length > 1) {
      clusters.push(currentCluster)
    }
    currentCluster = [candidate]
  }

  if (currentCluster.length > 1) {
    clusters.push(currentCluster)
  }

  return clusters.map((cluster) => {
    const rootIds = cluster.map((entry) => entry.subexpression.rootGroupId)
    return {
      id: `context:sequence:${parentContextId.replace(/:/g, '_')}:${rootIds.join(':')}`,
      kind: 'sequence' as const,
      parentContextId,
      semanticRootGroupId: rootIds[0] || null,
      anchorGroupIds: rootIds,
      memberGroupIds: uniqueIds(cluster.flatMap((entry) => entry.subexpression.memberGroupIds)),
    }
  })
}

const buildScriptContinuationSequenceContexts = (
  roles: StructuralRole[],
  subexpressions: LocalSubexpression[],
  groupMap: Map<string, StrokeGroup>,
  contexts: ExpressionContext[],
  brickHypothesesByGroupId: Map<string, LegoBrickHypothesis[]>,
  topBrickHypothesisByGroupId: Map<string, LegoBrickHypothesis>,
) => {
  const roleMap = new Map(roles.map((role) => [role.groupId, role]))
  const subexpressionsByRootId = new Map(subexpressions.map((subexpression) => [subexpression.rootGroupId, subexpression]))
  const usedRootIds = new Set<string>()
  const enclosureContexts = contexts.filter((context) => context.kind === 'enclosure')
  const hostedMemberContexts = contexts.filter((context) => (
    context.kind === 'numerator'
    || context.kind === 'denominator'
    || context.kind === 'radicand'
    || context.kind === 'radicalIndex'
  ))

  const baselineCandidates = subexpressions
    .map((subexpression) => ({
      subexpression,
      role: roleMap.get(subexpression.rootGroupId) || null,
      bounds: getSubexpressionBounds(subexpression, groupMap),
    }))
    .filter(({ role }) => role?.role === 'baseline' && role.parentGroupId == null)

  return roles
    .filter((role) => (role.role === 'superscript' || role.role === 'subscript') && role.parentGroupId)
    .flatMap((role) => {
      const scriptGroup = groupMap.get(role.groupId)
      if (!scriptGroup) return []

      const continuationRootIds: string[] = []
      let previousGroupId = role.groupId
      let previousBounds = scriptGroup.bounds

      const compatibleCandidates = baselineCandidates
        .filter(({ subexpression, role: candidateRole }) => {
          if (!candidateRole) return false
          if (usedRootIds.has(subexpression.rootGroupId)) return false
          if (!sequenceContextAllowsRoot(topBrickHypothesisByGroupId, subexpression.rootGroupId)) return false
          if ([...(candidateRole.containerGroupIds || [])].sort().join(',') !== [...role.containerGroupIds].sort().join(',')) return false
          if (hostedMemberContexts.some((context) => context.memberGroupIds.includes(subexpression.rootGroupId))) return false
          return true
        })
        .filter(({ bounds }) => bounds.left >= scriptGroup.bounds.left)
        .sort((left, right) => left.bounds.left - right.bounds.left)

      for (const candidate of compatibleCandidates) {
        const horizontalGap = candidate.bounds.left - previousBounds.right
        const bandReferenceY = continuationRootIds.length ? previousBounds.centerY : scriptGroup.bounds.centerY
        const verticalOffset = Math.abs(candidate.bounds.centerY - bandReferenceY)
        const inlineSupport = getInlineAffordanceScore(brickHypothesesByGroupId, previousGroupId, candidate.subexpression.rootGroupId)
        const compatibleGap = horizontalGap >= -8 && horizontalGap <= Math.max(56, Math.max(previousBounds.right - previousBounds.left, candidate.bounds.right - candidate.bounds.left) * 1.1)
        const compatibleBand = verticalOffset <= Math.max(40, Math.max(scriptGroup.bounds.height, candidate.bounds.bottom - candidate.bounds.top) * 1.1)

        if (!compatibleGap || !compatibleBand || !inlineSupport.supported) {
          if (continuationRootIds.length) break
          continue
        }

        continuationRootIds.push(candidate.subexpression.rootGroupId)
        usedRootIds.add(candidate.subexpression.rootGroupId)
        previousGroupId = candidate.subexpression.rootGroupId
        previousBounds = {
          ...candidate.bounds,
          width: candidate.bounds.right - candidate.bounds.left,
          height: candidate.bounds.bottom - candidate.bounds.top,
        }
      }

      if (!continuationRootIds.length) return []

      const parentContextId = role.containerGroupIds.length
        ? enclosureContexts.find((context) => role.containerGroupIds.every((groupId) => context.anchorGroupIds.includes(groupId)))?.id || 'context:root'
        : 'context:root'

      return [{
        id: `context:sequence:script:${role.groupId}:${continuationRootIds.join(':')}`,
        kind: 'sequence' as const,
        parentContextId,
        semanticRootGroupId: role.groupId,
        anchorGroupIds: uniqueIds([role.groupId, ...continuationRootIds]),
        memberGroupIds: uniqueIds(continuationRootIds.flatMap((rootId) => subexpressionsByRootId.get(rootId)?.memberGroupIds || [rootId])),
      }]
    })
}

const getSequenceContextBounds = (context: ExpressionContext, groupMap: Map<string, StrokeGroup>) => {
  const memberBounds = context.anchorGroupIds
    .map((groupId) => groupMap.get(groupId)?.bounds)
    .filter(Boolean) as StrokeGroup['bounds'][]
  if (!memberBounds.length) return null
  return mergeBounds(memberBounds.map((bounds) => ({
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
    centerX: bounds.centerX,
    centerY: bounds.centerY,
  })))
}

const getRightmostAnchorGroupId = (context: ExpressionContext, groupMap: Map<string, StrokeGroup>) => {
  return [...context.anchorGroupIds]
    .sort((left, right) => (groupMap.get(right)?.bounds.right || 0) - (groupMap.get(left)?.bounds.right || 0))[0] || null
}

const expandCompositeMemberGroupIds = (
  rootIds: string[],
  subexpressions: LocalSubexpression[],
  roleMap: Map<string, StructuralRole>,
  enclosureContexts: ExpressionContext[],
  groupMap: Map<string, StrokeGroup>,
  fractionBarGroup?: StrokeGroup | null,
) => {
  const subexpressionByRootId = new Map(subexpressions.map((subexpression) => [subexpression.rootGroupId, subexpression]))
  const expandedGroupIds = new Set<string>()
  const pendingEnclosureKeySet = new Set<string>()
  const attachmentChildrenByParentId = new Map<string, string[]>()

  for (const subexpression of subexpressions) {
    for (const attachment of subexpression.attachments) {
      const existing = attachmentChildrenByParentId.get(attachment.parentGroupId) || []
      attachmentChildrenByParentId.set(attachment.parentGroupId, [...existing, attachment.childGroupId])
    }
  }

  for (const rootId of rootIds) {
    const subexpression = subexpressionByRootId.get(rootId)
    for (const groupId of subexpression?.memberGroupIds || [rootId]) {
      expandedGroupIds.add(groupId)
    }

    const role = roleMap.get(rootId)
    for (const containerGroupId of role?.containerGroupIds || []) {
      pendingEnclosureKeySet.add(containerGroupId)
    }
  }

  if (fractionBarGroup) {
    const excludedGroupIds = new Set<string>()
    const excludedRoots = rootIds.flatMap((rootId) => {
      const subexpression = subexpressionByRootId.get(rootId)
      return (subexpression?.memberGroupIds || []).filter((groupId) => {
        if (groupId === rootId) return false
        const memberRole = roleMap.get(groupId)
        const memberGroup = groupMap.get(groupId)
        if (!memberRole || !memberGroup) return false
        if ((memberRole.role !== 'superscript' && memberRole.role !== 'subscript') || memberRole.parentGroupId !== rootId) return false
        return memberGroup.bounds.left >= fractionBarGroup.bounds.right + Math.max(10, fractionBarGroup.bounds.width * 0.08)
      })
    })

    const stack = [...excludedRoots]
    while (stack.length) {
      const currentId = stack.pop() as string
      if (excludedGroupIds.has(currentId)) continue
      excludedGroupIds.add(currentId)
      for (const childId of attachmentChildrenByParentId.get(currentId) || []) {
        stack.push(childId)
      }
    }

    for (const groupId of excludedGroupIds) {
      expandedGroupIds.delete(groupId)
    }
  }

  const enclosureContextsToMerge = enclosureContexts.filter((context) => context.anchorGroupIds.some((groupId) => pendingEnclosureKeySet.has(groupId)))
  for (const context of enclosureContextsToMerge) {
    for (const groupId of context.memberGroupIds) {
      expandedGroupIds.add(groupId)
    }
  }

  return uniqueIds(Array.from(expandedGroupIds))
}

const buildExpressionContexts = (
  groups: StrokeGroup[],
  roles: StructuralRole[],
  subexpressions: LocalSubexpression[],
  enclosures: EnclosureStructure[],
  fractionBindings: FractionStructureBinding[],
  radicalBindings: RadicalStructureBinding[],
  edges: LayoutEdge[],
  brickHypothesesByGroupId: Map<string, LegoBrickHypothesis[]>,
  topBrickHypothesisByGroupId: Map<string, LegoBrickHypothesis>,
) => {
  const contexts: ExpressionContext[] = []
  const roleMap = new Map(roles.map((role) => [role.groupId, role]))
  const groupMap = new Map(groups.map((group) => [group.id, group]))

  contexts.push({
    id: 'context:root',
    kind: 'root',
    parentContextId: null,
    semanticRootGroupId: null,
    anchorGroupIds: uniqueIds(roles.filter((role) => (role.role === 'baseline' || role.role === 'radical') && role.containerGroupIds.length === 0).map((role) => role.groupId)),
    memberGroupIds: groups.filter((group) => (roleMap.get(group.id)?.containerGroupIds.length || 0) === 0).map((group) => group.id),
  })

  for (const enclosure of enclosures) {
    const memberRoles = enclosure.memberRootIds.map((groupId) => roleMap.get(groupId)).filter(Boolean) as StructuralRole[]
    const enclosedGroupIds = roles
      .filter((role) => role.containerGroupIds.includes(enclosure.openGroupId) && role.containerGroupIds.includes(enclosure.closeGroupId))
      .map((role) => role.groupId)
    const semanticRoot = memberRoles.sort((left, right) => {
      const leftIsBaseline = left.role === 'baseline' ? 0 : 1
      const rightIsBaseline = right.role === 'baseline' ? 0 : 1
      if (leftIsBaseline !== rightIsBaseline) return leftIsBaseline - rightIsBaseline
      return left.groupId.localeCompare(right.groupId)
    })[0] || null
    const outerContainerGroupIds = (semanticRoot?.containerGroupIds || [])
      .filter((groupId) => groupId !== enclosure.openGroupId && groupId !== enclosure.closeGroupId)
    const parentContextId = outerContainerGroupIds.length ? `context:enclosure:${outerContainerGroupIds.join(':')}` : 'context:root'
    contexts.push({
      id: `context:enclosure:${enclosure.openGroupId}:${enclosure.closeGroupId}`,
      kind: 'enclosure',
      parentContextId,
      semanticRootGroupId: semanticRoot?.groupId || enclosure.memberRootIds[0] || null,
      anchorGroupIds: uniqueIds([enclosure.openGroupId, enclosure.closeGroupId, ...(semanticRoot ? [semanticRoot.groupId] : [])]),
      memberGroupIds: uniqueIds([enclosure.openGroupId, enclosure.closeGroupId, ...enclosure.memberRootIds, ...enclosedGroupIds]),
    })
  }

  contexts.push(...buildSequenceContexts(roles, subexpressions, groupMap, 'context:root', [], edges, brickHypothesesByGroupId, topBrickHypothesisByGroupId))

  for (const enclosureContext of contexts.filter((context) => context.kind === 'enclosure')) {
    const containerGroupIds = enclosureContext.anchorGroupIds.filter((groupId) => groupId !== enclosureContext.semanticRootGroupId)
    contexts.push(...buildSequenceContexts(roles, subexpressions, groupMap, enclosureContext.id, containerGroupIds, edges, brickHypothesesByGroupId, topBrickHypothesisByGroupId))
  }

  const enclosureContexts = contexts.filter((context) => context.kind === 'enclosure')

  for (const radicalRole of roles.filter((role) => role.role === 'radical')) {
    const binding = radicalBindings.find((candidate) => candidate.radicalGroupId === radicalRole.groupId) || null
    const radicandRootIds = getOrderedRootIds(binding?.radicandRootIds || [], groupMap)
    const indexRootIds = getOrderedRootIds(binding?.indexRootIds || [], groupMap)
    const radicandSemanticRootId = radicandRootIds[0] || null
    const indexSemanticRootId = indexRootIds[0] || null
    const radicandMembers = expandCompositeMemberGroupIds(radicandRootIds, subexpressions, roleMap, enclosureContexts, groupMap)
    const indexMembers = expandCompositeMemberGroupIds(indexRootIds, subexpressions, roleMap, enclosureContexts, groupMap)
    const parentContextId = radicalRole.containerGroupIds.length
      ? `context:enclosure:${radicalRole.containerGroupIds.join(':')}`
      : 'context:root'

    contexts.push({
      id: `context:radical:${radicalRole.groupId}`,
      kind: 'radical',
      parentContextId,
      semanticRootGroupId: radicalRole.groupId,
      anchorGroupIds: uniqueIds([radicalRole.groupId, ...(radicandSemanticRootId ? [radicandSemanticRootId] : []), ...(indexSemanticRootId ? [indexSemanticRootId] : [])]),
      memberGroupIds: uniqueIds([radicalRole.groupId, ...radicandMembers, ...indexMembers]),
    })

    if (radicandSemanticRootId && radicandMembers.length) {
      contexts.push({
        id: `context:radicand:${radicandSemanticRootId}`,
        kind: 'radicand',
        parentContextId: `context:radical:${radicalRole.groupId}`,
        semanticRootGroupId: radicandSemanticRootId,
        anchorGroupIds: uniqueIds([radicalRole.groupId, radicandSemanticRootId]),
        memberGroupIds: radicandMembers,
      })
    }

    if (indexSemanticRootId && indexMembers.length) {
      contexts.push({
        id: `context:radicalIndex:${indexSemanticRootId}`,
        kind: 'radicalIndex',
        parentContextId: `context:radical:${radicalRole.groupId}`,
        semanticRootGroupId: indexSemanticRootId,
        anchorGroupIds: uniqueIds([radicalRole.groupId, indexSemanticRootId]),
        memberGroupIds: indexMembers,
      })
    }
  }

  for (const fractionBarRole of roles.filter((role) => role.role === 'fractionBar' || role.role === 'provisionalFractionBar')) {
    const binding = fractionBindings.find((candidate) => candidate.barGroupId === fractionBarRole.groupId) || null
    const numeratorRootIds = getOrderedRootIds(binding?.numeratorRootIds || [], groupMap)
    const denominatorRootIds = getOrderedRootIds(binding?.denominatorRootIds || [], groupMap)
    const numeratorSemanticRootId = numeratorRootIds[0] || null
    const denominatorSemanticRootId = denominatorRootIds[0] || null
    const fractionBarGroup = groupMap.get(fractionBarRole.groupId) || null
    const numeratorMembers = expandCompositeMemberGroupIds(numeratorRootIds, subexpressions, roleMap, enclosureContexts, groupMap, fractionBarGroup)
    const denominatorMembers = expandCompositeMemberGroupIds(denominatorRootIds, subexpressions, roleMap, enclosureContexts, groupMap, fractionBarGroup)
    const parentContextId = fractionBarRole.containerGroupIds.length
      ? `context:enclosure:${fractionBarRole.containerGroupIds.join(':')}`
      : 'context:root'

    contexts.push({
      id: `context:fraction:${fractionBarRole.groupId}`,
      kind: 'fraction',
      parentContextId,
      semanticRootGroupId: fractionBarRole.groupId,
      anchorGroupIds: uniqueIds([fractionBarRole.groupId, ...(numeratorSemanticRootId ? [numeratorSemanticRootId] : []), ...(denominatorSemanticRootId ? [denominatorSemanticRootId] : [])]),
      memberGroupIds: uniqueIds([fractionBarRole.groupId, ...numeratorMembers, ...denominatorMembers]),
    })

    if (numeratorSemanticRootId && numeratorMembers.length) {
      contexts.push({
        id: `context:numerator:${numeratorSemanticRootId}`,
        kind: 'numerator',
        parentContextId: `context:fraction:${fractionBarRole.groupId}`,
        semanticRootGroupId: numeratorSemanticRootId,
        anchorGroupIds: uniqueIds([fractionBarRole.groupId, numeratorSemanticRootId]),
        memberGroupIds: numeratorMembers,
      })
    }

    if (denominatorSemanticRootId && denominatorMembers.length) {
      contexts.push({
        id: `context:denominator:${denominatorSemanticRootId}`,
        kind: 'denominator',
        parentContextId: `context:fraction:${fractionBarRole.groupId}`,
        semanticRootGroupId: denominatorSemanticRootId,
        anchorGroupIds: uniqueIds([fractionBarRole.groupId, denominatorSemanticRootId]),
        memberGroupIds: denominatorMembers,
      })
    }
  }

  return contexts
}

const annotateRolesWithContexts = (roles: StructuralRole[], contexts: ExpressionContext[], groups: StrokeGroup[]) => {
  const roleMap = new Map(roles.map((role) => [role.groupId, role]))
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const enclosureContexts = contexts.filter((context) => context.kind === 'enclosure')
  const sequenceContexts = contexts.filter((context) => context.kind === 'sequence')
  const fractionContexts = contexts.filter((context) => context.kind === 'fraction')
  const radicalContexts = contexts.filter((context) => context.kind === 'radical')
  const fractionMemberContexts = contexts.filter((context) => (
    context.kind === 'numerator'
    || context.kind === 'denominator'
    || context.kind === 'radicand'
    || context.kind === 'radicalIndex'
  ))

  return roles.map((role) => {
    if ((role.role !== 'superscript' && role.role !== 'subscript') || !role.parentGroupId) {
      const hostedContext = getHostedContextForRole(role, contexts)
      const defaultContextId = hostedContext?.id || (
        role.containerGroupIds.length
          ? enclosureContexts.find((context) => role.containerGroupIds.every((groupId) => context.anchorGroupIds.includes(groupId)))?.id || 'context:root'
          : 'context:root'
      )
      return {
        ...role,
        associationContextId: role.associationContextId || defaultContextId,
        hostedContextId: hostedContext?.id || null,
        hostedContextKind: hostedContext?.kind || null,
        normalizationAnchorGroupIds: role.normalizationAnchorGroupIds.length ? role.normalizationAnchorGroupIds : (hostedContext?.anchorGroupIds || [role.groupId]),
        evidence: hostedContext && !role.evidence.some((entry) => entry === `hosted-context=${hostedContext.id}`)
          ? [...role.evidence, `hosted-context=${hostedContext.id}`]
          : role.evidence,
      }
    }

    const parentRole = roleMap.get(role.parentGroupId)
    const childContainerIds = new Set(role.containerGroupIds)
    const parentOnlyContainers = (parentRole?.containerGroupIds || []).filter((groupId) => !childContainerIds.has(groupId))
    const enclosureContext = parentOnlyContainers.length
      ? enclosureContexts.find((context) => parentOnlyContainers.every((groupId) => context.anchorGroupIds.includes(groupId))) || null
      : null
    const sequenceContext = sequenceContexts.find((context) => {
      if (!context.memberGroupIds.includes(role.parentGroupId || '')) return false
      const sequenceBounds = getSequenceContextBounds(context, groupMap)
      const scriptGroup = groupMap.get(role.groupId)
      if (!sequenceBounds || !scriptGroup) return false
      return scriptGroup.bounds.left >= sequenceBounds.right + Math.max(12, (sequenceBounds.right - sequenceBounds.left) * 0.06)
    }) || null
    const sharedFractionMemberContext = fractionMemberContexts.find((context) => context.memberGroupIds.includes(role.groupId) && context.memberGroupIds.includes(role.parentGroupId || '')) || null
    const parentHostedFractionMemberContext = getHostedFractionMemberContext(role.parentGroupId || '', contexts)
    const fractionContext = parentHostedFractionMemberContext?.parentContextId
      ? fractionContexts.find((context) => context.id === parentHostedFractionMemberContext.parentContextId) || null
      : (parentRole?.parentGroupId
        ? fractionContexts.find((context) => context.semanticRootGroupId === parentRole.parentGroupId && context.memberGroupIds.includes(parentRole.groupId)) || null
        : null)
    const radicalContext = parentRole?.role === 'radical'
      ? radicalContexts.find((context) => context.semanticRootGroupId === parentRole.groupId) || null
      : null
    const fractionWideOutsideMember = Boolean(sharedFractionMemberContext) && isFractionWideOutsideHostedMember(role.groupId, role.parentGroupId, contexts, groupMap)

    if (!enclosureContext && fractionContext && (!sharedFractionMemberContext || fractionWideOutsideMember)) {
      const anchorGroupIds = uniqueIds(fractionContext.anchorGroupIds)
      return {
        ...role,
        associationContextId: fractionContext.id,
        hostedContextId: sharedFractionMemberContext?.id || null,
        hostedContextKind: sharedFractionMemberContext?.kind || null,
        normalizationAnchorGroupIds: anchorGroupIds,
        evidence: [...role.evidence, `association-context=${fractionContext.id}`, `normalization-anchors=${anchorGroupIds.join(',')}`],
      }
    }

    if (!enclosureContext && !sharedFractionMemberContext && sequenceContext) {
      const anchorGroupIds = uniqueIds(sequenceContext.anchorGroupIds)
      return {
        ...role,
        associationContextId: sequenceContext.id,
        hostedContextId: null,
        hostedContextKind: null,
        normalizationAnchorGroupIds: anchorGroupIds,
        evidence: [...role.evidence, `association-context=${sequenceContext.id}`, `normalization-anchors=${anchorGroupIds.join(',')}`],
      }
    }

    if (!enclosureContext) {
      const hostedContext = sharedFractionMemberContext || getHostedContextForRole(role, contexts)
      return {
        ...role,
        associationContextId: role.associationContextId || sharedFractionMemberContext?.id || radicalContext?.id || (role.containerGroupIds.length ? `context:enclosure:${role.containerGroupIds.join(':')}` : 'context:root'),
        hostedContextId: hostedContext?.id || null,
        hostedContextKind: hostedContext?.kind || null,
        normalizationAnchorGroupIds: role.normalizationAnchorGroupIds.length ? role.normalizationAnchorGroupIds : [role.parentGroupId],
      }
    }

    const anchorGroupIds = uniqueIds([role.parentGroupId, ...enclosureContext.anchorGroupIds])
    return {
      ...role,
      associationContextId: enclosureContext.id,
      hostedContextId: enclosureContext.id,
      hostedContextKind: enclosureContext.kind,
      normalizationAnchorGroupIds: anchorGroupIds,
      evidence: [...role.evidence, `association-context=${enclosureContext.id}`, `normalization-anchors=${anchorGroupIds.join(',')}`],
    }
  }).map((role) => ({
    ...role,
    associationContextId: role.associationContextId || 'context:root',
    hostedContextId: role.hostedContextId || null,
    hostedContextKind: role.hostedContextKind || null,
    normalizationAnchorGroupIds: role.normalizationAnchorGroupIds.length ? role.normalizationAnchorGroupIds : [role.groupId],
  }))
}

const resolveStructuralAdmissibility = (groups: StrokeGroup[], roles: StructuralRole[], edges: LayoutEdge[]) => {
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const roleMap = new Map(roles.map((role) => [role.groupId, role]))
  const baselineRoles = roles.filter((role) => role.role === 'baseline')
  const byContext = new Map<string, StructuralRole[]>()

  for (const role of baselineRoles) {
    const contextKey = getRoleContextKey(role)
    const bucket = byContext.get(contextKey) || []
    bucket.push(role)
    byContext.set(contextKey, bucket)
  }

  const flags: StructuralFlag[] = []
  for (const [contextKey, bucket] of byContext.entries()) {
    const ordered = [...bucket].sort((left, right) => {
      const topDelta = (groupMap.get(left.groupId)?.bounds.top || 0) - (groupMap.get(right.groupId)?.bounds.top || 0)
      if (topDelta !== 0) return topDelta
      return (groupMap.get(left.groupId)?.bounds.left || 0) - (groupMap.get(right.groupId)?.bounds.left || 0)
    })
    const keptBaselineIds: string[] = []

    for (const candidate of ordered) {
      const candidateGroup = groupMap.get(candidate.groupId)
      if (!candidateGroup) continue

      const conflictingKeptRole = keptBaselineIds
        .map((groupId) => roleMap.get(groupId))
        .find((keptRole) => {
          if (!keptRole) return false
          const keptGroup = groupMap.get(keptRole.groupId)
          if (!keptGroup) return false
          return keptGroup.bounds.top <= candidateGroup.bounds.top
            ? isSameContextStackedPair(keptGroup, candidateGroup)
            : isSameContextStackedPair(candidateGroup, keptGroup)
        })

      if (!conflictingKeptRole) {
        keptBaselineIds.push(candidate.groupId)
        continue
      }

      roleMap.set(candidate.groupId, makeUnsupportedRole(candidate, [
        'unsupported same-context stacked baseline',
        `conflicts-with=${conflictingKeptRole.groupId}`,
      ]))
      flags.push({
        kind: 'sameContextStackedBaselines',
        severity: 'warning',
        groupIds: [conflictingKeptRole.groupId, candidate.groupId],
        contextKey,
        message: 'Multiple baseline candidates occupy vertically stacked positions in the same local context. The lower conflicting group was preserved as ink but demoted from baseline to unsupportedSymbol.',
      })
    }
  }

  const scriptBuckets = new Map<string, StructuralRole[]>()
  for (const role of roleMap.values()) {
    if (role.role !== 'superscript' && role.role !== 'subscript') continue
    if (!role.parentGroupId) continue
    const contextKey = getScriptContextKey(role)
    const bucket = scriptBuckets.get(contextKey) || []
    bucket.push(role)
    scriptBuckets.set(contextKey, bucket)
  }

  for (const [contextKey, bucket] of scriptBuckets.entries()) {
    if (bucket.length < 2) continue
    const parentGroupId = bucket[0]?.parentGroupId || null
    if (!parentGroupId) continue
    const parentGroup = groupMap.get(parentGroupId)
    if (!parentGroup) continue

    const ordered = [...bucket].sort((left, right) => {
      const leftGroup = groupMap.get(left.groupId)
      const rightGroup = groupMap.get(right.groupId)
      if (!leftGroup || !rightGroup) return 0
      const leftScore = getScriptLocalityScore(left, parentGroup, leftGroup) * 0.78 + getSizeComparabilityScore(parentGroup, leftGroup) * 0.22
      const rightScore = getScriptLocalityScore(right, parentGroup, rightGroup) * 0.78 + getSizeComparabilityScore(parentGroup, rightGroup) * 0.22
      return rightScore - leftScore
    })

    const keptScriptIds: string[] = []
    for (const candidate of ordered) {
      const candidateGroup = groupMap.get(candidate.groupId)
      if (!candidateGroup) continue
      const conflictingKeptRole = keptScriptIds
        .map((groupId) => roleMap.get(groupId))
        .find((keptRole) => {
          if (!keptRole) return false
          const keptGroup = groupMap.get(keptRole.groupId)
          if (!keptGroup) return false
          return isSameParentStackedScriptPair(keptGroup, candidateGroup)
        })

      if (!conflictingKeptRole) {
        keptScriptIds.push(candidate.groupId)
        continue
      }

      roleMap.set(candidate.groupId, makeUnsupportedRole(candidate, [
        `unsupported same-parent stacked ${candidate.role}`,
        `conflicts-with=${conflictingKeptRole.groupId}`,
        'spatial closeness dominates size comparability when resolving local script siblings',
      ]))
      const scriptRole = candidate.role === 'superscript' ? 'superscript' : 'subscript'
      flags.push({
        kind: 'sameParentStackedScripts',
        severity: 'warning',
        groupIds: [conflictingKeptRole.groupId, candidate.groupId],
        contextKey,
        parentGroupId,
        scriptRole,
        message: `Multiple ${scriptRole} candidates stack in the same local context around one parent. The weaker sibling was preserved as ink but demoted to unsupportedSymbol.`,
      })
    }
  }

  const baselineFallbacks = Array.from(roleMap.values()).filter((role) => role.role === 'baseline')
  for (const role of baselineFallbacks) {
    const candidateGroup = groupMap.get(role.groupId)
    if (!candidateGroup) continue

    const scriptEvidence = [
      {
        role: 'superscript' as const,
        edge: incomingByKind(edges, role.groupId, 'superscriptCandidate')[0] || null,
      },
      {
        role: 'subscript' as const,
        edge: incomingByKind(edges, role.groupId, 'subscriptCandidate')[0] || null,
      },
    ]
      .filter((entry) => entry.edge && entry.edge.score >= 0.3)
      .sort((left, right) => (right.edge?.score || 0) - (left.edge?.score || 0))[0] || null

    if (!scriptEvidence?.edge) continue

    const siblingScript = Array.from(roleMap.values()).find((candidateRole) => {
      if (candidateRole.role !== scriptEvidence.role) return false
      if (candidateRole.parentGroupId !== scriptEvidence.edge?.fromId) return false
      const sameContainers = [...candidateRole.containerGroupIds].sort().join(',') === [...role.containerGroupIds].sort().join(',')
      if (!sameContainers) return false
      const siblingGroup = groupMap.get(candidateRole.groupId)
      if (!siblingGroup) return false
      return isSameParentStackedScriptPair(siblingGroup, candidateGroup)
    })

    if (!siblingScript || !scriptEvidence.edge.fromId) continue

    roleMap.set(role.groupId, makeUnsupportedRole(role, [
      `unsupported same-parent stacked ${scriptEvidence.role}`,
      `conflicts-with=${siblingScript.groupId}`,
      `candidate-parent=${scriptEvidence.edge.fromId}`,
      'baseline fallback was rejected because local script spatiality remained stronger',
    ]))
    flags.push({
      kind: 'sameParentStackedScripts',
      severity: 'warning',
      groupIds: [siblingScript.groupId, role.groupId],
      contextKey: `role:${scriptEvidence.role}|parent:${scriptEvidence.edge.fromId}|containers:${[...role.containerGroupIds].sort().join(',') || 'root'}`,
      parentGroupId: scriptEvidence.edge.fromId,
      scriptRole: scriptEvidence.role,
      message: `A baseline fallback still carried strong ${scriptEvidence.role} evidence in the same local context as an existing sibling script. It was preserved as ink but demoted to unsupportedSymbol.`,
    })
  }

  return {
    roles: Array.from(roleMap.values())
      .map((role) => ({ ...role, depth: role.parentGroupId ? roleDepth(roleMap, role.groupId) : 0 }))
      .sort((left, right) => left.depth - right.depth),
    flags,
  }
}

export const inferStructuralRoles = (groups: StrokeGroup[], edges: LayoutEdge[], brickHypotheses: LegoBrickHypothesis[] = []) => {
  const roles = new Map<string, StructuralRole>()
  const ambiguities: StructuralAmbiguity[] = []
  const semanticFlags: StructuralFlag[] = []
  const brickHypothesesByGroupId = buildBrickHypothesesByGroupId(brickHypotheses)
  const topBrickHypothesisByGroupId = getTopBrickHypothesisByGroupId(brickHypotheses)
  const fieldClaimsByTargetGroupId = buildFieldClaimMap(buildConcreteLegoFieldLayer(groups, brickHypotheses).fieldClaims)
  const operatorAlternativeScoreByGroupId = new Map<string, number>()
  for (const hypothesis of brickHypotheses) {
    if (hypothesis.family !== 'operatorBrick') continue
    const currentScore = operatorAlternativeScoreByGroupId.get(hypothesis.groupId) || 0
    if (hypothesis.score > currentScore) {
      operatorAlternativeScoreByGroupId.set(hypothesis.groupId, hypothesis.score)
    }
  }
  const fractionBarLikeGroups = groups.filter((group) => {
    const topHypothesis = topBrickHypothesisByGroupId.get(group.id)
    const operatorAlternativeScore = brickHypotheses.find((hypothesis) => (
      hypothesis.groupId === group.id && hypothesis.family === 'operatorBrick'
    ))?.score || 0
    if (shouldPreferInlineOperatorOverFractionLikeRole(group, edges, groups, operatorAlternativeScore)) {
      return false
    }

    if (topHypothesis) {
      if (topHypothesis.family !== 'fractionBarBrick' || topHypothesis.score < 0.52) {
        return false
      }

      if (isFractionBarLikeGroup(group)) {
        return true
      }

      const bestScriptScore = Math.max(
        bestIncoming(edges, group.id, 'superscriptCandidate')?.score || 0,
        bestIncoming(edges, group.id, 'subscriptCandidate')?.score || 0,
      )

      return topHypothesis.score >= Math.max(0.68, operatorAlternativeScore + 0.12) && bestScriptScore < 0.38
    }
    return isFractionBarLikeGroup(group)
  })
  const fractionBarIds = new Set(fractionBarLikeGroups.map((group) => group.id))
  const enclosureBoundaryCandidateGroups = groups.filter((group) => {
    const topHypothesis = topBrickHypothesisByGroupId.get(group.id)
    if (topHypothesis) {
      return topHypothesis.family === 'enclosureBoundaryBrick' && topHypothesis.score >= 0.5
    }
    return isEnclosureBoundaryCandidate(group)
  })
  const radicalGroups = groups.filter((group) => {
    const radicalScore = brickHypotheses.find((hypothesis) => (
      hypothesis.groupId === group.id && hypothesis.family === 'radicalBrick'
    ))?.score || 0
    const operatorScore = brickHypotheses.find((hypothesis) => (
      hypothesis.groupId === group.id && hypothesis.family === 'operatorBrick'
    ))?.score || 0
    return radicalScore >= Math.max(0.72, operatorScore + 0.08)
  })
  const enclosureBoundaryIds = new Set(enclosureBoundaryCandidateGroups.map((group) => group.id))
  const radicalIds = new Set(radicalGroups.map((group) => group.id))
  const blockedAttachmentIds = new Set<string>([...fractionBarIds, ...enclosureBoundaryIds, ...radicalIds])
  const stableAttachments = collectStableAttachments(groups, edges, blockedAttachmentIds, topBrickHypothesisByGroupId, fieldClaimsByTargetGroupId)
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const { subexpressions, rootClaims } = buildLocalSubexpressions(groups, stableAttachments, fractionBarIds)
  const childIds = new Set(stableAttachments.map((attachment) => attachment.childId))
  const enclosures = detectEnclosures(enclosureBoundaryCandidateGroups, subexpressions, groupMap, fractionBarIds)
  const fractionBindings: FractionStructureBinding[] = []
  const radicalBindings: RadicalStructureBinding[] = []
  const containerIdsByGroupId = new Map<string, string[]>()
  const enclosureByBoundaryId = new Map<string, EnclosureStructure & { memberGroupIds: string[] }>()

  for (const enclosure of enclosures) {
    enclosureByBoundaryId.set(enclosure.openGroupId, enclosure)
    enclosureByBoundaryId.set(enclosure.closeGroupId, enclosure)
    roles.set(enclosure.openGroupId, makeRole(enclosure.openGroupId, 'enclosureOpen', enclosure.score, 0, null, [
      'left enclosure boundary',
      `members=${enclosure.memberRootIds.join(',')}`,
      `peers=${getRoleDescriptor('enclosureOpen').peerRoles.join(',')}`,
    ]))
    roles.set(enclosure.closeGroupId, makeRole(enclosure.closeGroupId, 'enclosureClose', enclosure.score, 0, null, [
      'right enclosure boundary',
      `members=${enclosure.memberRootIds.join(',')}`,
      `peers=${getRoleDescriptor('enclosureClose').peerRoles.join(',')}`,
    ]))
    for (const memberGroupId of enclosure.memberGroupIds) {
      const current = containerIdsByGroupId.get(memberGroupId) || []
      containerIdsByGroupId.set(memberGroupId, [...current, enclosure.openGroupId, enclosure.closeGroupId])
    }
  }

  const confirmedFractionBars = fractionBarLikeGroups
    .map((bar) => ({ bar, context: scoreFractionContext(bar, subexpressions, groupMap, fieldClaimsByTargetGroupId) }))
    .filter(({ context }) => hasConfirmedFractionMemberSupport(context))

  const conflictReducedConfirmedFractionBars = suppressStandaloneFractionBarsInsideHostedFraction(confirmedFractionBars)

  const confirmedFractionBarIdSet = new Set(conflictReducedConfirmedFractionBars.map(({ bar }) => bar.id))
  const radicalStructureBarrierGroups = radicalGroups
  const fractionBaselineReleaseCandidateByGroupId = new Map<string, FractionBaselineReleaseCandidate>()
  const admittedConfirmedFractionBars = conflictReducedConfirmedFractionBars.filter(({ bar, context }) => {
    const completeFractionSupport = hasConfirmedFractionMemberSupport(context)
    if (completeFractionSupport) return true
    if (context.barRecognitionScore > 0.12) return true

    const releaseCandidate = getFractionBaselineReleaseCandidate(
      bar,
      context,
      edges,
      groups,
      operatorAlternativeScoreByGroupId.get(bar.id) || 0,
      'fractionBar',
      context.barRecognitionScore,
    )
    if (!releaseCandidate) return true
    fractionBaselineReleaseCandidateByGroupId.set(bar.id, releaseCandidate)
    return false
  })
  const admittedConfirmedFractionBarIdSet = new Set(admittedConfirmedFractionBars.map(({ bar }) => bar.id))

  const provisionalFractionBars = fractionBarLikeGroups
    .map((bar) => ({ bar, context: scoreFractionContext(bar, subexpressions, groupMap, fieldClaimsByTargetGroupId) }))
    .filter(({ bar }) => !admittedConfirmedFractionBarIdSet.has(bar.id))
    .filter(({ context }) => hasProvisionalFractionMemberSupport(context))
    .filter(({ bar, context }) => {
      const minusFallbackCandidate = getUnvindicatedFractionMinusFallbackCandidate(
        bar,
        context,
        edges,
        groups,
        operatorAlternativeScoreByGroupId.get(bar.id) || 0,
      )
      if (minusFallbackCandidate) {
        fractionBaselineReleaseCandidateByGroupId.set(bar.id, minusFallbackCandidate)
        return false
      }

      const releaseCandidate = getFractionBaselineReleaseCandidate(
        bar,
        context,
        edges,
        groups,
        operatorAlternativeScoreByGroupId.get(bar.id) || 0,
        'provisionalFractionBar',
        Math.max(PROVISIONAL_FRACTION_BAR_MIN_SCORE, context.barRecognitionScore),
      )
      if (!releaseCandidate) return true
      fractionBaselineReleaseCandidateByGroupId.set(bar.id, releaseCandidate)
      return false
    })

  const admittedFractionBarGroups = [...admittedConfirmedFractionBars.map(({ bar }) => bar), ...provisionalFractionBars.map(({ bar }) => bar)]
  const admittedFractionBarIds = new Set(admittedFractionBarGroups.map((group) => group.id))
  const fractionStructureBarrierGroups = admittedFractionBarGroups

  for (const { bar, context } of admittedConfirmedFractionBars) {
    roles.set(bar.id, makeRole(bar.id, 'fractionBar', context.barRecognitionScore, 0, null, [
      `family=${getRoleDescriptor('fractionBar').family}`,
      `operator-kind=${getRoleDescriptor('fractionBar').operatorKind}`,
      `operand-mode=${getRoleDescriptor('fractionBar').operandReferenceMode}`,
      `allowed-operands=${getRoleDescriptor('fractionBar').allowedOperandRoles.join(',')}`,
      `allowed-children=${getRoleDescriptor('fractionBar').allowedChildRoles.join(',')}`,
      `forbidden-children=${getRoleDescriptor('fractionBar').forbiddenChildRoles.join(',')}`,
      `shape=${context.shapeScore.toFixed(2)}`,
      `centered-above=${context.numeratorAggregate?.centeredScore.toFixed(2) || '0.00'}`,
      `centered-below=${context.denominatorAggregate?.centeredScore.toFixed(2) || '0.00'}`,
      `width-match=${context.numeratorAggregate?.widthScore.toFixed(2) || '0.00'}`,
      `joint-score=${context.bestHypothesis?.score.toFixed(2) || '0.00'}`,
      `mutual-reinforcement=${context.mutualReinforcementScore.toFixed(2)}`,
      `local-coherence=${context.localCoherenceScore.toFixed(2)}`,
      `global-compatibility=${context.globalCompatibilityScore.toFixed(2)}`,
      `revision-pressure=${context.revisionPressureScore.toFixed(2)}`,
      `axis-consistency=${context.bestHypothesis?.axisConsistency.toFixed(2) || '0.00'}`,
      `member-width-harmony=${context.bestHypothesis?.memberWidthHarmony.toFixed(2) || '0.00'}`,
      `provisional-above=${context.provisionalNumeratorScore.toFixed(2)}`,
      `provisional-below=${context.provisionalDenominatorScore.toFixed(2)}`,
    ]))

    const strongButIncomplete = !(context.numeratorRoots.length > 0 && context.denominatorRoots.length > 0)
    if (strongButIncomplete) {
      semanticFlags.push({
        kind: 'incompleteFractionStructure',
        severity: 'warning',
        groupIds: [bar.id],
        barGroupId: bar.id,
        missingSide: 'both',
        message: 'A strongly fraction-like bar was recognized as a fraction operator, but the surrounding expression does not yet provide a valid numerator/denominator pair.',
      })
    }
  }

  for (const { bar, context } of provisionalFractionBars) {
    roles.set(bar.id, makeRole(bar.id, 'provisionalFractionBar', Math.max(0.42, context.barRecognitionScore), 0, null, [
      `family=${getRoleDescriptor('provisionalFractionBar').family}`,
      `operator-kind=${getRoleDescriptor('provisionalFractionBar').operatorKind}`,
      `operand-mode=${getRoleDescriptor('provisionalFractionBar').operandReferenceMode}`,
      `shape=${context.shapeScore.toFixed(2)}`,
      `joint-score=${context.bestHypothesis?.score.toFixed(2) || '0.00'}`,
      `mutual-reinforcement=${context.mutualReinforcementScore.toFixed(2)}`,
      `local-coherence=${context.localCoherenceScore.toFixed(2)}`,
      `global-compatibility=${context.globalCompatibilityScore.toFixed(2)}`,
      `revision-pressure=${context.revisionPressureScore.toFixed(2)}`,
      `provisional-above=${context.provisionalNumeratorScore.toFixed(2)}`,
      `provisional-below=${context.provisionalDenominatorScore.toFixed(2)}`,
      'line-like group is being preserved as a provisional fraction operator while operand evidence remains incomplete',
    ], containerIdsByGroupId.get(bar.id) || []))

    const provisionalNumeratorRoots = context.provisionalNumeratorScore >= PROVISIONAL_FRACTION_SIDE_MIN_SCORE
      ? prioritizeRootId(context.numeratorRoots.map((candidate) => candidate.rootGroupId), context.preferredNumeratorRootId, groupMap)
      : []
    const provisionalDenominatorRoots = context.provisionalDenominatorScore >= PROVISIONAL_FRACTION_SIDE_MIN_SCORE
      ? prioritizeRootId(context.denominatorRoots.map((candidate) => candidate.rootGroupId), context.preferredDenominatorRootId, groupMap)
      : []

    fractionBindings.push({
      barGroupId: bar.id,
      numeratorRootIds: provisionalNumeratorRoots,
      denominatorRootIds: provisionalDenominatorRoots,
    })

    const provisionalNumeratorRootId = provisionalNumeratorRoots[0] || null
    const provisionalDenominatorRootId = provisionalDenominatorRoots[0] || null

    if (provisionalNumeratorRootId && !roles.has(provisionalNumeratorRootId)) {
      ambiguities.push({
        groupId: provisionalNumeratorRootId,
        reason: 'fraction-membership',
        chosenRole: 'numerator',
        candidates: rebalanceCompetingCandidates([
          makeCandidate('numerator', Math.max(0.58, context.provisionalNumeratorScore), bar.id, ['centered above provisional fraction bar', 'one-sided fraction-member reinforcement']),
          makeCandidate('baseline', 0.34, null, ['fallback root role']),
        ]),
      })
    }

    if (provisionalDenominatorRootId && !roles.has(provisionalDenominatorRootId)) {
      ambiguities.push({
        groupId: provisionalDenominatorRootId,
        reason: 'fraction-membership',
        chosenRole: 'denominator',
        candidates: rebalanceCompetingCandidates([
          makeCandidate('denominator', Math.max(0.58, context.provisionalDenominatorScore), bar.id, ['centered below provisional fraction bar', 'one-sided fraction-member reinforcement']),
          makeCandidate('baseline', 0.34, null, ['fallback root role']),
        ]),
      })
    }

    const missingSide = provisionalNumeratorRootId
      ? (provisionalDenominatorRootId ? null : 'denominator')
      : (provisionalDenominatorRootId ? 'numerator' : 'both')
    if (missingSide) {
      semanticFlags.push({
        kind: 'incompleteFractionStructure',
        severity: 'warning',
        groupIds: uniqueIds([bar.id, ...(provisionalNumeratorRootId ? [provisionalNumeratorRootId] : []), ...(provisionalDenominatorRootId ? [provisionalDenominatorRootId] : [])]),
        barGroupId: bar.id,
        missingSide,
        message: missingSide === 'both'
          ? 'A fraction-like bar has no valid numerator or denominator, so it is preserved only as provisional structure.'
          : `A fraction-like bar is missing its ${missingSide}, so cross-bar symbol attachments are blocked and the bar remains provisional.`,
      })
    }
  }

  for (const { bar, context } of admittedConfirmedFractionBars) {
    const numeratorRoots = context.memberClaimScore >= 0.46 && context.denominatorRoots.length > 0
      ? prioritizeRootId(context.numeratorRoots.map((candidate) => candidate.rootGroupId), context.preferredNumeratorRootId, groupMap)
      : []
    const denominatorRoots = context.memberClaimScore >= 0.46 && context.denominatorRoots.length > 0
      ? prioritizeRootId(context.denominatorRoots.map((candidate) => candidate.rootGroupId), context.preferredDenominatorRootId, groupMap)
      : []
    const numeratorPrimaryRootId = numeratorRoots[0] || null
    const denominatorPrimaryRootId = denominatorRoots[0] || null

    fractionBindings.push({
      barGroupId: bar.id,
      numeratorRootIds: numeratorRoots,
      denominatorRootIds: denominatorRoots,
    })

    if (numeratorPrimaryRootId) {
      if (!roleUsesChildOperands('fractionBar') || !roleAllowsChildRole('fractionBar', 'numerator') || !roleAllowsOperandRole('fractionBar', 'numerator')) continue
      const candidates = rebalanceCompetingCandidates([
        makeCandidate('numerator', 0.82, bar.id, ['centered above confirmed fraction bar', 'inherits fraction-member ancestry']),
        makeCandidate('baseline', 0.36, null, ['fallback root role']),
      ])
      ambiguities.push({
        groupId: numeratorPrimaryRootId,
        reason: 'fraction-membership',
        chosenRole: 'numerator',
        candidates,
      })
    }

    if (denominatorPrimaryRootId) {
      if (!roleUsesChildOperands('fractionBar') || !roleAllowsChildRole('fractionBar', 'denominator') || !roleAllowsOperandRole('fractionBar', 'denominator')) continue
      const candidates = rebalanceCompetingCandidates([
        makeCandidate('denominator', 0.82, bar.id, ['centered below confirmed fraction bar', 'inherits fraction-member ancestry']),
        makeCandidate('baseline', 0.35, null, ['fallback root role']),
      ])
      ambiguities.push({
        groupId: denominatorPrimaryRootId,
        reason: 'fraction-membership',
        chosenRole: 'denominator',
        candidates,
      })
    }
  }

  for (const radicalGroup of radicalGroups) {
    if (roles.has(radicalGroup.id)) continue
    const context = scoreRadicalContext(radicalGroup, subexpressions, groupMap, fieldClaimsByTargetGroupId)
    if (!context.radicandRoots.length || context.radicandScore < 0.44) continue

    radicalBindings.push({
      radicalGroupId: radicalGroup.id,
      radicandRootIds: prioritizeRootId(context.radicandRoots, context.preferredRadicandRootId, groupMap),
      indexRootIds: prioritizeRootId(context.indexRoots, context.preferredIndexRootId, groupMap),
    })

    roles.set(radicalGroup.id, makeRole(radicalGroup.id, 'radical', Math.max(0.64, context.radicandScore * 0.72 + context.indexScore * 0.12), 0, null, [
      `family=${getRoleDescriptor('radical').family}`,
      `operator-kind=${getRoleDescriptor('radical').operatorKind}`,
      `operand-mode=${getRoleDescriptor('radical').operandReferenceMode}`,
      `radicand-score=${context.radicandScore.toFixed(2)}`,
      `index-score=${context.indexScore.toFixed(2)}`,
      `radicand-roots=${context.radicandRoots.join(',') || 'none'}`,
      `index-roots=${context.indexRoots.join(',') || 'none'}`,
    ], containerIdsByGroupId.get(radicalGroup.id) || []))
  }

  for (const subexpression of subexpressions) {
    const rootClaim = rootClaims.get(subexpression.rootGroupId)
    subexpression.rootRole = rootClaim?.role || 'baseline'
    const shouldMaterializeRoot = subexpression.attachments.length > 0 || subexpression.rootRole !== 'baseline'
    if (shouldMaterializeRoot && !roles.has(subexpression.rootGroupId)) {
      roles.set(subexpression.rootGroupId, makeRole(
        subexpression.rootGroupId,
        subexpression.rootRole,
        subexpression.rootRole === 'baseline' ? 0.72 : 0.82,
        0,
        null,
        [
          'root of local subexpression',
          `family=${getRoleDescriptor(subexpression.rootRole).family}`,
          `allowed-children=${getRoleDescriptor(subexpression.rootRole).allowedChildRoles.join(',') || 'none'}`,
          `forbidden-children=${getRoleDescriptor(subexpression.rootRole).forbiddenChildRoles.join(',') || 'none'}`,
        ],
        containerIdsByGroupId.get(subexpression.rootGroupId) || [],
      ))
    }
    for (const attachment of subexpression.attachments) {
      const hostFieldSupport = hostSupportsScriptField(topBrickHypothesisByGroupId, attachment.parentGroupId, attachment.role)
      const claimSupport = getScriptFieldClaimSupport(fieldClaimsByTargetGroupId, attachment.childGroupId, attachment.parentGroupId, attachment.role)
      const attachmentEdge = incomingByKind(edges, attachment.childGroupId, attachment.role === 'superscript' ? 'superscriptCandidate' : 'subscriptCandidate')
        .find((edge) => edge.fromId === attachment.parentGroupId) || null
      roles.set(attachment.childGroupId, makeRole(attachment.childGroupId, attachment.role, attachment.score, 1, attachment.parentGroupId, [
        'owned by local subexpression',
        `family=${getRoleDescriptor(attachment.role).family}`,
        `peers=${getRoleDescriptor(attachment.role).peerRoles.join(',') || 'none'}`,
        `host-field=${getScriptFieldKind(attachment.role)}:${hostFieldSupport.fieldWeight === null ? 'legacy' : hostFieldSupport.fieldWeight.toFixed(2)}`,
        attachment.role === 'superscript'
          ? `above-right=${attachmentEdge?.metrics.dx > 0 && attachmentEdge?.metrics.dy < 0 ? '1' : '0'}`
          : `below-right=${(attachmentEdge?.metrics.belowRightScore || 0).toFixed(2)}`,
        attachment.role === 'subscript' ? `directly-below=${(attachmentEdge?.metrics.directlyBelowScore || 0).toFixed(2)}` : undefined,
        attachmentEdge ? `size-ratio=${(attachmentEdge.metrics.sizeRatio || 0).toFixed(2)}` : undefined,
        ...claimSupport.evidence,
      ].filter(Boolean) as string[], containerIdsByGroupId.get(attachment.childGroupId) || []))
    }
  }

  const remaining = groups.filter((group) => !roles.has(group.id) && !admittedFractionBarIds.has(group.id) && !radicalIds.has(group.id) && !childIds.has(group.id))
  for (const group of remaining) {
    const superCandidates = incomingByKind(edges, group.id, 'superscriptCandidate')
    const subCandidates = incomingByKind(edges, group.id, 'subscriptCandidate')
    const bestSuperEntry = findBestAdmissibleScriptEdge(superCandidates, 'superscript', groupMap, topBrickHypothesisByGroupId, fieldClaimsByTargetGroupId, fractionStructureBarrierGroups, radicalStructureBarrierGroups)
    const bestSubEntry = findBestAdmissibleScriptEdge(subCandidates, 'subscript', groupMap, topBrickHypothesisByGroupId, fieldClaimsByTargetGroupId, fractionStructureBarrierGroups, radicalStructureBarrierGroups)
    const bestSuper = bestSuperEntry?.edge || null
    const bestSub = bestSubEntry?.edge || null
    const bestSequence = bestIncoming(edges, group.id, 'sequence')
    const bestSequenceInlineClaimSupport = bestSequence ? getInlinePairClaimSupport(fieldClaimsByTargetGroupId, bestSequence.fromId, group.id) : null
    const inlineMinusLikeSuppression = getMinusBaselineClaimScore(group) >= 0.9 && getInlineNeighborBaselineClaimScore(group, groups) >= 0.8
    const candidates: StructuralRoleCandidate[] = [makeCandidate('baseline', 0.34, null, ['fallback root role'])]
    const releasedFractionBaselineCandidate = fractionBaselineReleaseCandidateByGroupId.get(group.id) || null

    if (releasedFractionBaselineCandidate) {
      candidates.push(releasedFractionBaselineCandidate)
    }

    if (bestSuper && !releasedFractionBaselineCandidate && !inlineMinusLikeSuppression) {
      const hostFieldSupport = bestSuperEntry?.hostFieldSupport || hostSupportsScriptField(topBrickHypothesisByGroupId, bestSuper.fromId, 'superscript')
      const claimSupport = bestSuperEntry?.claimSupport || getScriptFieldClaimSupport(fieldClaimsByTargetGroupId, group.id, bestSuper.fromId, 'superscript')
      if (hostFieldSupport.supported) {
        candidates.push(makeCandidate('superscript', bestSuperEntry?.adjustedScore || clamp(bestSuper.score * 0.8 + claimSupport.score * 0.2, 0, 1), bestSuper.fromId, [
          `above-right=${bestSuper.metrics.dx > 0 && bestSuper.metrics.dy < 0 ? '1' : '0'}`,
          `size-ratio=${(bestSuper.metrics.sizeRatio || 0).toFixed(2)}`,
          `host-field=upperRightScript:${hostFieldSupport.fieldWeight === null ? 'legacy' : hostFieldSupport.fieldWeight.toFixed(2)}`,
          ...claimSupport.evidence,
          'direct-host-barrier=none',
        ]))
      }
    }
    if (bestSub && !releasedFractionBaselineCandidate && !inlineMinusLikeSuppression) {
      const hostFieldSupport = bestSubEntry?.hostFieldSupport || hostSupportsScriptField(topBrickHypothesisByGroupId, bestSub.fromId, 'subscript')
      const claimSupport = bestSubEntry?.claimSupport || getScriptFieldClaimSupport(fieldClaimsByTargetGroupId, group.id, bestSub.fromId, 'subscript')
      if (hostFieldSupport.supported) {
        candidates.push(makeCandidate('subscript', bestSubEntry?.adjustedScore || clamp(bestSub.score * 0.8 + claimSupport.score * 0.2, 0, 1), bestSub.fromId, [
          `below-right=${(bestSub.metrics.belowRightScore || 0).toFixed(2)}`,
          `directly-below=${(bestSub.metrics.directlyBelowScore || 0).toFixed(2)}`,
          `width-ratio=${(bestSub.metrics.widthRatio || 0).toFixed(2)}`,
          `host-field=lowerRightScript:${hostFieldSupport.fieldWeight === null ? 'legacy' : hostFieldSupport.fieldWeight.toFixed(2)}`,
          ...claimSupport.evidence,
          'direct-host-barrier=none',
        ]))
      }
    }

    if (bestSequence) {
      const sequenceScore = clamp(
        bestSequence.score * 0.72
          + (bestSequenceInlineClaimSupport?.score || 0) * 0.22
          + (bestSequenceInlineClaimSupport?.supported ? 0.06 : 0),
        0,
        1,
      )
      candidates.push(makeCandidate('baseline', Math.max(0.24, sequenceScore), null, [
        'inline sequence fallback',
        ...(bestSequenceInlineClaimSupport?.evidence || []),
      ]))
    }

    const fractionWideFallbackCandidates = Array.from(roles.values())
      .filter((role) => role.role === 'numerator' || role.role === 'denominator')
      .flatMap((role) => {
        const parentGroup = groupMap.get(role.groupId)
        if (!parentGroup || !isFractionWideOutsideMember(group.id, role, groupMap)) return []
        return (['superscript', 'subscript'] as const)
          .map((scriptRole) => {
            const localityScore = getScriptLocalityScoreByKind(scriptRole, parentGroup, group)
            if (localityScore < 0.42) return null
            return makeCandidate(scriptRole, 0.34 + localityScore * 0.24, role.groupId, [
              'fraction-wide geometry fallback',
              `locality=${localityScore.toFixed(2)}`,
              `fallback-role=${scriptRole}`,
            ])
          })
          .filter(Boolean) as StructuralRoleCandidate[]
      })
      .filter(Boolean)
      .sort((left, right) => (right?.score || 0) - (left?.score || 0))[0] || null

    if (fractionWideFallbackCandidates) {
      candidates.push(fractionWideFallbackCandidates)
    }

    const radicalWideFallbackCandidate = Array.from(roles.values())
      .filter((role) => role.role === 'baseline')
      .flatMap((role) => {
        const radicalBinding = getRadicalWideBindingForParentGroupId(role.groupId, radicalBindings)
        const radicalGroup = radicalBinding ? groupMap.get(radicalBinding.radicalGroupId) || null : null
        const radicalBounds = radicalBinding ? getRadicalBindingBounds(radicalBinding, groupMap) : null
        if (!radicalBinding || !radicalGroup || !radicalBounds || !isRadicalWideOutsideMember(group.id, role.groupId, radicalBindings, groupMap)) return []
        return (['superscript', 'subscript'] as const)
          .map((scriptRole) => {
            const radicalWidth = Math.max(1, radicalBounds.right - radicalBounds.left)
            const radicalHeight = Math.max(1, radicalBounds.bottom - radicalBounds.top)
            const horizontalGap = Math.max(0, group.bounds.left - radicalBounds.right)
            const horizontalCloseness = clamp(1 - horizontalGap / Math.max(24, radicalWidth * 0.24), 0, 1)
            const targetY = scriptRole === 'superscript'
              ? radicalBounds.top + radicalHeight * 0.08
              : radicalBounds.bottom - radicalHeight * 0.08
            const verticalCloseness = scriptRole === 'superscript'
              ? clamp(1 - Math.abs(group.bounds.bottom - targetY) / Math.max(28, radicalHeight * 0.6), 0, 1)
              : clamp(1 - Math.abs(group.bounds.top - targetY) / Math.max(28, radicalHeight * 0.6), 0, 1)
            const localityScore = horizontalCloseness * 0.58 + verticalCloseness * 0.42
            if (localityScore < 0.4) return null
            return makeCandidate(scriptRole, 0.4 + localityScore * 0.28, radicalBinding.radicalGroupId, [
              'radical-wide geometry fallback',
              `locality=${localityScore.toFixed(2)}`,
              `fallback-role=${scriptRole}`,
              `radical-host=${radicalBinding.radicalGroupId}`,
            ])
          })
          .filter(Boolean) as StructuralRoleCandidate[]
      })
      .filter(Boolean)
      .sort((left, right) => (right?.score || 0) - (left?.score || 0))[0] || null

    if (radicalWideFallbackCandidate) {
      candidates.push(radicalWideFallbackCandidate)
    }

    const best = chooseBestCandidate(candidates)
    const sortedCandidates = [...candidates].sort((left, right) => right.score - left.score)
    const runnerUp = sortedCandidates[1]

    let resolvedParentGroupId = best.parentGroupId || null
    const parentEnclosure = resolvedParentGroupId ? enclosureByBoundaryId.get(resolvedParentGroupId) || null : null
    if ((best.role === 'superscript' || best.role === 'subscript') && resolvedParentGroupId && parentEnclosure) {
      const redirectedParentId = getEnclosureSemanticRootId(parentEnclosure, resolvedParentGroupId, groupMap)
      if (redirectedParentId) {
        resolvedParentGroupId = redirectedParentId
      }
    }
    if (resolvedParentGroupId === group.id) {
      resolvedParentGroupId = null
    }

    const parentRole = resolvedParentGroupId ? roles.get(resolvedParentGroupId) : null
    const assumedOperandRole = parentRole?.role || 'baseline'
    const ignoredBarrierIds = new Set<string>(
      best.parentGroupId && best.parentGroupId !== resolvedParentGroupId
        ? [best.parentGroupId]
        : [],
    )
    if (best.parentGroupId && best.parentGroupId !== resolvedParentGroupId && parentEnclosure) {
      for (const memberGroupId of parentEnclosure.memberGroupIds) {
        ignoredBarrierIds.add(memberGroupId)
      }
    }
    const hostBarrier = best.role === 'superscript' || best.role === 'subscript'
      ? getDirectScriptHostBarrier(groupMap, topBrickHypothesisByGroupId, resolvedParentGroupId, group.id, ignoredBarrierIds)
        || getCrossFractionStructureBarrier(groupMap, fractionStructureBarrierGroups, resolvedParentGroupId, group.id, ignoredBarrierIds)
        || getCrossRadicalStructureBarrier(groupMap, radicalStructureBarrierGroups, resolvedParentGroupId, group.id, ignoredBarrierIds)
        || getRadicalWholeScriptHostBarrier(groupMap, radicalStructureBarrierGroups, resolvedParentGroupId, group.id, ignoredBarrierIds)
      : null
    const hostFieldSupport = best.role === 'superscript' || best.role === 'subscript'
      ? hostSupportsScriptField(topBrickHypothesisByGroupId, resolvedParentGroupId, best.role)
      : { supported: true, fieldWeight: null as number | null }
    const parentSupportsAttachment = Boolean(resolvedParentGroupId)
      && !admittedFractionBarIds.has(resolvedParentGroupId)
      && !hostBarrier
      && (!roleRequiresOperandReference(best.role) || roleUsesParentOperand(best.role))
      && roleAllowsOperandRole(best.role, assumedOperandRole)
      && hostFieldSupport.supported
      && (!parentRole || (roleCanOwnScripts(parentRole.role) && roleAllowsChildRole(parentRole.role, best.role)))

    const promotableFractionWideCandidate = sortedCandidates.find((candidate) => {
      if ((candidate.role !== 'superscript' && candidate.role !== 'subscript') || !candidate.parentGroupId) return false
      const candidateParentRole = roles.get(candidate.parentGroupId) || null
      return isFractionWideOutsideMember(group.id, candidateParentRole, groupMap)
    }) || null

    const promotableRadicalWideCandidate = sortedCandidates.find((candidate) => {
      if ((candidate.role !== 'superscript' && candidate.role !== 'subscript') || !candidate.parentGroupId) return false
      return isRadicalWideOutsideMember(group.id, candidate.parentGroupId, radicalBindings, groupMap)
    }) || null

    const promotableSequenceWideCandidate = sortedCandidates.find((candidate) => {
      if ((candidate.role !== 'superscript' && candidate.role !== 'subscript') || !candidate.parentGroupId) return false
      return allowsSequenceWideTrailingScriptPromotion(
        groupMap,
        brickHypothesesByGroupId,
        topBrickHypothesisByGroupId,
        fieldClaimsByTargetGroupId,
        candidate.parentGroupId,
        group.id,
        candidate.role,
      )
    }) || null

    const selectedScriptCandidate = (() => {
      if ((best.role === 'superscript' || best.role === 'subscript') && resolvedParentGroupId && parentSupportsAttachment) {
        const directRadicalWideBinding = isRadicalWideOutsideMember(group.id, resolvedParentGroupId, radicalBindings, groupMap)
          ? getRadicalWideBindingForParentGroupId(resolvedParentGroupId, radicalBindings)
          : null
        const directPromotedParentGroupId = directRadicalWideBinding?.radicalGroupId || resolvedParentGroupId
        const directPromotedParentRole = roles.get(directPromotedParentGroupId) || parentRole
        const sequenceWideEligible = allowsSequenceWideTrailingScriptPromotion(
          groupMap,
          brickHypothesesByGroupId,
          topBrickHypothesisByGroupId,
          fieldClaimsByTargetGroupId,
          resolvedParentGroupId,
          group.id,
          best.role,
        )
        const minimumScore = (isFractionWideOutsideMember(group.id, parentRole || null, groupMap)
          || isRadicalWideOutsideMember(group.id, resolvedParentGroupId, radicalBindings, groupMap)
          || sequenceWideEligible)
          ? 0.32
          : 0.4
        if (best.score >= minimumScore) {
          return {
            candidate: directPromotedParentGroupId === resolvedParentGroupId
              ? best
              : { ...best, parentGroupId: directPromotedParentGroupId },
            parentGroupId: directPromotedParentGroupId,
            parentRole: directPromotedParentRole,
            promotionKind: isFractionWideOutsideMember(group.id, parentRole || null, groupMap)
              ? 'fraction'
              : directRadicalWideBinding
                ? 'radical'
                : sequenceWideEligible
                  ? 'sequence'
                  : null,
          }
        }
      }

      if (promotableSequenceWideCandidate?.parentGroupId) {
        const promotedParentRole = roles.get(promotableSequenceWideCandidate.parentGroupId) || null
        const promotedScriptRole = promotableSequenceWideCandidate.role as 'superscript' | 'subscript'
        const promotedHostBarrier = getDirectScriptHostBarrier(groupMap, topBrickHypothesisByGroupId, promotableSequenceWideCandidate.parentGroupId, group.id)
          || getCrossFractionStructureBarrier(groupMap, fractionStructureBarrierGroups, promotableSequenceWideCandidate.parentGroupId, group.id)
          || getCrossRadicalStructureBarrier(groupMap, radicalStructureBarrierGroups, promotableSequenceWideCandidate.parentGroupId, group.id)
          || getRadicalWholeScriptHostBarrier(groupMap, radicalStructureBarrierGroups, promotableSequenceWideCandidate.parentGroupId, group.id)
        const promotedHostFieldSupport = hostSupportsScriptField(topBrickHypothesisByGroupId, promotableSequenceWideCandidate.parentGroupId, promotedScriptRole)
        const promotedParentSupportsAttachment = (!roleRequiresOperandReference(promotableSequenceWideCandidate.role) || roleUsesParentOperand(promotableSequenceWideCandidate.role))
          && roleAllowsOperandRole(promotableSequenceWideCandidate.role, promotedParentRole?.role || 'baseline')
          && !promotedHostBarrier
          && promotedHostFieldSupport.supported
          && (!promotedParentRole || (roleCanOwnScripts(promotedParentRole.role) && roleAllowsChildRole(promotedParentRole.role, promotableSequenceWideCandidate.role)))
        if (
          promotedParentSupportsAttachment
          && promotableSequenceWideCandidate.score >= 0.32
          && (sortedCandidates[0]?.score || 0) - promotableSequenceWideCandidate.score <= 0.12
        ) {
          return {
            candidate: promotableSequenceWideCandidate,
            parentGroupId: promotableSequenceWideCandidate.parentGroupId,
            parentRole: promotedParentRole,
            promotionKind: 'sequence',
          }
        }
      }

      if (promotableRadicalWideCandidate?.parentGroupId) {
        const promotedRadicalBinding = getRadicalWideBindingForParentGroupId(promotableRadicalWideCandidate.parentGroupId, radicalBindings)
        const promotedRadicalParentGroupId = promotedRadicalBinding?.radicalGroupId || promotableRadicalWideCandidate.parentGroupId
        const promotedRadicalParentRole = roles.get(promotedRadicalParentGroupId) || null
        const promotedRadicalScriptRole = promotableRadicalWideCandidate.role as 'superscript' | 'subscript'
        const promotedRadicalHostBarrier = getDirectScriptHostBarrier(groupMap, topBrickHypothesisByGroupId, promotedRadicalParentGroupId, group.id)
          || getCrossFractionStructureBarrier(groupMap, fractionStructureBarrierGroups, promotedRadicalParentGroupId, group.id)
          || getCrossRadicalStructureBarrier(groupMap, radicalStructureBarrierGroups, promotedRadicalParentGroupId, group.id)
          || getRadicalWholeScriptHostBarrier(groupMap, radicalStructureBarrierGroups, promotedRadicalParentGroupId, group.id)
        const promotedRadicalHostFieldSupport = hostSupportsScriptField(topBrickHypothesisByGroupId, promotedRadicalParentGroupId, promotedRadicalScriptRole)
        const promotedRadicalParentSupportsAttachment = (!roleRequiresOperandReference(promotableRadicalWideCandidate.role) || roleUsesParentOperand(promotableRadicalWideCandidate.role))
          && roleAllowsOperandRole(promotableRadicalWideCandidate.role, promotedRadicalParentRole?.role || 'baseline')
          && !promotedRadicalHostBarrier
          && promotedRadicalHostFieldSupport.supported
          && (!promotedRadicalParentRole || (roleCanOwnScripts(promotedRadicalParentRole.role) && roleAllowsChildRole(promotedRadicalParentRole.role, promotableRadicalWideCandidate.role)))
        if (!promotedRadicalParentSupportsAttachment) return null
        if (promotableRadicalWideCandidate.score < 0.32) return null
        if ((sortedCandidates[0]?.score || 0) - promotableRadicalWideCandidate.score > 0.18) return null

        return {
          candidate: promotedRadicalParentGroupId === promotableRadicalWideCandidate.parentGroupId
            ? promotableRadicalWideCandidate
            : { ...promotableRadicalWideCandidate, parentGroupId: promotedRadicalParentGroupId },
          parentGroupId: promotedRadicalParentGroupId,
          parentRole: promotedRadicalParentRole,
          promotionKind: 'radical',
        }
      }

      if (!promotableFractionWideCandidate?.parentGroupId) return null
      const promotedFractionParentRole = roles.get(promotableFractionWideCandidate.parentGroupId) || null
      const promotedFractionScriptRole = promotableFractionWideCandidate.role as 'superscript' | 'subscript'
      const promotedFractionHostBarrier = getDirectScriptHostBarrier(groupMap, topBrickHypothesisByGroupId, promotableFractionWideCandidate.parentGroupId, group.id)
        || getCrossFractionStructureBarrier(groupMap, fractionStructureBarrierGroups, promotableFractionWideCandidate.parentGroupId, group.id)
        || getCrossRadicalStructureBarrier(groupMap, radicalStructureBarrierGroups, promotableFractionWideCandidate.parentGroupId, group.id)
        || getRadicalWholeScriptHostBarrier(groupMap, radicalStructureBarrierGroups, promotableFractionWideCandidate.parentGroupId, group.id)
      const promotedFractionHostFieldSupport = hostSupportsScriptField(topBrickHypothesisByGroupId, promotableFractionWideCandidate.parentGroupId, promotedFractionScriptRole)
      const promotedFractionParentSupportsAttachment = (!roleRequiresOperandReference(promotableFractionWideCandidate.role) || roleUsesParentOperand(promotableFractionWideCandidate.role))
        && roleAllowsOperandRole(promotableFractionWideCandidate.role, promotedFractionParentRole?.role || 'baseline')
        && !promotedFractionHostBarrier
        && promotedFractionHostFieldSupport.supported
        && (!promotedFractionParentRole || (roleCanOwnScripts(promotedFractionParentRole.role) && roleAllowsChildRole(promotedFractionParentRole.role, promotableFractionWideCandidate.role)))
      if (!promotedFractionParentSupportsAttachment) return null
      if (promotableFractionWideCandidate.score < 0.32) return null
      if ((sortedCandidates[0]?.score || 0) - promotableFractionWideCandidate.score > 0.18) return null

      return {
        candidate: promotableFractionWideCandidate,
        parentGroupId: promotableFractionWideCandidate.parentGroupId,
        parentRole: promotedFractionParentRole,
        promotionKind: 'fraction',
      }
    })()

    if (selectedScriptCandidate) {
      const selectedScriptRole = selectedScriptCandidate.candidate.role as 'superscript' | 'subscript'
      const selectedHostFieldSupport = hostSupportsScriptField(topBrickHypothesisByGroupId, selectedScriptCandidate.parentGroupId, selectedScriptRole)
      const nextRole = makeRole(group.id, selectedScriptCandidate.candidate.role, selectedScriptCandidate.candidate.score, 1, selectedScriptCandidate.parentGroupId, [
        ...(selectedScriptCandidate.candidate.evidence || []),
        `parent-family=${selectedScriptCandidate.parentRole ? selectedScriptCandidate.parentRole.descriptor.family : 'expressionRoot'}`,
        `host-field=${getScriptFieldKind(selectedScriptRole)}:${selectedHostFieldSupport.fieldWeight === null ? 'legacy' : selectedHostFieldSupport.fieldWeight.toFixed(2)}`,
        `operator-kind=${getRoleDescriptor(selectedScriptCandidate.candidate.role).operatorKind}`,
        `operand-mode=${getRoleDescriptor(selectedScriptCandidate.candidate.role).operandReferenceMode}`,
        `operand-allows=${String(roleAllowsOperandRole(selectedScriptCandidate.candidate.role, selectedScriptCandidate.parentRole?.role || 'baseline'))}`,
        `redirected-parent=${selectedScriptCandidate.candidate.parentGroupId && selectedScriptCandidate.candidate.parentGroupId !== selectedScriptCandidate.parentGroupId ? `${selectedScriptCandidate.candidate.parentGroupId}->${selectedScriptCandidate.parentGroupId}` : 'none'}`,
        `parent-allows=${selectedScriptCandidate.parentRole ? String(roleAllowsChildRole(selectedScriptCandidate.parentRole.role, selectedScriptCandidate.candidate.role)) : 'true'}`,
        `fraction-wide-promotion=${selectedScriptCandidate.promotionKind === 'fraction' ? 'true' : 'false'}`,
        `promotion-kind=${selectedScriptCandidate.promotionKind || 'none'}`,
        `ancestry=${getRoleDescriptor(selectedScriptCandidate.candidate.role).ancestry.join('>')}`,
      ], containerIdsByGroupId.get(group.id) || [])
      roles.set(group.id, nextRole)
      if (selectedScriptCandidate.promotionKind === 'fraction' || isFractionWideOutsideMember(group.id, selectedScriptCandidate.parentRole || null, groupMap)) {
        const baselineAlternative = sortedCandidates.find((candidate) => candidate.role === 'baseline') || null
        if (baselineAlternative) {
          ambiguities.push({
            groupId: group.id,
            reason: 'fraction-wide-script-vs-baseline',
            chosenRole: selectedScriptCandidate.candidate.role,
            candidates: [selectedScriptCandidate.candidate, baselineAlternative],
          })
        }
      }
      if (selectedScriptCandidate.promotionKind === 'radical' || isRadicalWideOutsideMember(group.id, selectedScriptCandidate.parentGroupId, radicalBindings, groupMap)) {
        const baselineAlternative = sortedCandidates.find((candidate) => candidate.role === 'baseline') || null
        if (baselineAlternative) {
          ambiguities.push({
            groupId: group.id,
            reason: 'radical-wide-script-vs-baseline',
            chosenRole: selectedScriptCandidate.candidate.role,
            candidates: [selectedScriptCandidate.candidate, baselineAlternative],
          })
        }
      }
      if ((bestSequence && bestSequence.score >= 0.16 && Math.abs(selectedScriptCandidate.candidate.score - bestSequence.score) <= 0.3) || (runnerUp && Math.abs(selectedScriptCandidate.candidate.score - runnerUp.score) <= 0.14)) {
        ambiguities.push({
          groupId: group.id,
          reason: bestSequence && bestSequence.score >= 0.16 && Math.abs(selectedScriptCandidate.candidate.score - bestSequence.score) <= 0.3 ? 'sequence-vs-script' : 'competing-relations',
          chosenRole: selectedScriptCandidate.candidate.role,
          candidates: sortedCandidates.slice(0, 3),
        })
      }
      continue
    }

    roles.set(group.id, makeRole(group.id, 'baseline', sortedCandidates[0]?.score || 0.34, 0, null, [
      ...(sortedCandidates[0]?.evidence || []),
      'defaulted to baseline after candidate comparison',
      `family=${getRoleDescriptor('baseline').family}`,
    ], containerIdsByGroupId.get(group.id) || []))

    const closeScriptCandidate = [...superCandidates, ...subCandidates][0] || null
    if (
      (bestSequence && closeScriptCandidate && bestSequence.score >= 0.16 && closeScriptCandidate.score >= 0.45 && Math.abs(bestSequence.score - closeScriptCandidate.score) <= 0.34) ||
      (runnerUp && runnerUp.score >= 0.5 && Math.abs(sortedCandidates[0].score - runnerUp.score) <= 0.12)
    ) {
      ambiguities.push({
        groupId: group.id,
        reason: bestSequence && closeScriptCandidate && bestSequence.score >= 0.16 && Math.abs(bestSequence.score - closeScriptCandidate.score) <= 0.34 ? 'sequence-vs-script' : 'competing-relations',
        chosenRole: 'baseline',
        candidates: sortedCandidates.slice(0, 3),
      })
    }
  }

  for (const role of roles.values()) {
    role.depth = roleDepth(roles, role.groupId)
  }

  const resolvedRoles = groups
    .map((group) => {
      const existing = roles.get(group.id)
      if (existing) return existing
      if (admittedFractionBarIds.has(group.id)) {
        return makeRole(group.id, 'unsupportedSymbol', 0.58, 0, null, [
          'line-like group did not satisfy supported fraction structure requirements',
          'preserved instead of defaulting to baseline',
          `family=${getRoleDescriptor('unsupportedSymbol').family}`,
        ], containerIdsByGroupId.get(group.id) || [])
      }
      return makeRole(group.id, 'baseline', 0.5, 0, null, ['fallback default'], containerIdsByGroupId.get(group.id) || [])
    })
    .sort((left, right) => left.depth - right.depth)
  const { roles: operandSafeRoles, flags: operandFlags } = demoteMissingOperandScripts(resolvedRoles)
  const { roles: admissibleRoles, flags } = resolveStructuralAdmissibility(groups, operandSafeRoles, edges)
  const fractionSemanticRootSafeRoles = ensureFractionSemanticRootsRemainBaseline(admissibleRoles, fractionBindings, groups)
  const radicalSemanticRootSafeRoles = ensureFractionSemanticRootsRemainBaseline(fractionSemanticRootSafeRoles, radicalBindings.map((binding) => ({
    barGroupId: binding.radicalGroupId,
    numeratorRootIds: binding.radicandRootIds,
    denominatorRootIds: binding.indexRootIds,
  })), groups)
  const contexts = buildExpressionContexts(groups, radicalSemanticRootSafeRoles, subexpressions, enclosures, fractionBindings, radicalBindings, edges, brickHypothesesByGroupId, topBrickHypothesisByGroupId)
  const sequencePromotedRoles = promoteSequenceWideScripts(
    radicalSemanticRootSafeRoles,
    contexts,
    subexpressions,
    groups,
    edges,
    brickHypothesesByGroupId,
    topBrickHypothesisByGroupId,
  )
  const promotedContexts = buildExpressionContexts(groups, sequencePromotedRoles, subexpressions, enclosures, fractionBindings, radicalBindings, edges, brickHypothesesByGroupId, topBrickHypothesisByGroupId)
  const scriptContinuationContexts = buildScriptContinuationSequenceContexts(sequencePromotedRoles, subexpressions, groupMap, promotedContexts, brickHypothesesByGroupId, topBrickHypothesisByGroupId)
  const allContexts = [...promotedContexts, ...scriptContinuationContexts]
  const annotatedRoles = annotateRolesWithContexts(sequencePromotedRoles, allContexts, groups)
  const enclosurePromotedRoles = promoteEnclosureWideScripts(annotatedRoles, allContexts, groups)
  const radicalPromotedRoles = promoteRadicalWideScripts(enclosurePromotedRoles, allContexts, groups)
  const annotatedRoleMap = new Map(radicalPromotedRoles.map((role) => [role.groupId, role]))
  const contextualizedRoles = radicalPromotedRoles.map((role) => ({
    ...role,
    depth: role.parentGroupId ? roleDepth(annotatedRoleMap, role.groupId) : 0,
  }))
  const identityAwareRoles = annotateRolesWithRecognizedSymbols(contextualizedRoles, groups)
  const finalRadicalWideRoles = forcePromoteRadicalWideScripts(identityAwareRoles, radicalBindings, groups)
  const fractionAwareAmbiguities = appendFractionWideScriptAmbiguities(finalRadicalWideRoles, groups, allContexts, ambiguities)
  const radicalAwareAmbiguities = appendRadicalWideScriptAmbiguities(finalRadicalWideRoles, groups, allContexts, fractionAwareAmbiguities)
  const contextualizedAmbiguities = appendEnclosureWideScriptAmbiguities(finalRadicalWideRoles, allContexts, radicalAwareAmbiguities)

  return {
    roles: finalRadicalWideRoles,
    flags: [...semanticFlags, ...operandFlags, ...flags],
    subexpressions,
    enclosures,
    contexts: allContexts,
    ambiguities: contextualizedAmbiguities,
  }
}