import { clamp } from './geometry'
import { getTopBrickHypothesisByGroupId } from './legoModel'
import type {
  InkBounds,
  LegoBrickHypothesis,
  LegoFieldClaim,
  LegoFieldInstance,
  LegoFieldIntersection,
  LegoFieldKind,
  StrokeGroup,
} from './types'

type FieldLayer = {
  fieldInstances: LegoFieldInstance[]
  fieldIntersections: LegoFieldIntersection[]
  fieldClaims: LegoFieldClaim[]
}

const makeBounds = (left: number, top: number, right: number, bottom: number): InkBounds => {
  const normalizedLeft = Math.min(left, right)
  const normalizedRight = Math.max(left, right)
  const normalizedTop = Math.min(top, bottom)
  const normalizedBottom = Math.max(top, bottom)
  const width = normalizedRight - normalizedLeft
  const height = normalizedBottom - normalizedTop

  return {
    left: normalizedLeft,
    top: normalizedTop,
    right: normalizedRight,
    bottom: normalizedBottom,
    width,
    height,
    centerX: normalizedLeft + width / 2,
    centerY: normalizedTop + height / 2,
  }
}

const getBoundsArea = (bounds: InkBounds) => Math.max(0, bounds.width) * Math.max(0, bounds.height)

const getBoundsIntersection = (left: InkBounds, right: InkBounds): InkBounds | null => {
  const intersectionLeft = Math.max(left.left, right.left)
  const intersectionTop = Math.max(left.top, right.top)
  const intersectionRight = Math.min(left.right, right.right)
  const intersectionBottom = Math.min(left.bottom, right.bottom)
  if (intersectionRight <= intersectionLeft || intersectionBottom <= intersectionTop) return null
  return makeBounds(intersectionLeft, intersectionTop, intersectionRight, intersectionBottom)
}

const isPointInsideBounds = (x: number, y: number, bounds: InkBounds) => (
  x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
)

const getDistanceScoreToBoundsCenter = (x: number, y: number, bounds: InkBounds) => {
  const radius = Math.max(18, Math.hypot(bounds.width, bounds.height) * 0.5)
  const distance = Math.hypot(x - bounds.centerX, y - bounds.centerY)
  return clamp(1 - distance / radius, 0, 1)
}

const getFieldOwnershipBias = (kind: LegoFieldKind) => {
  switch (kind) {
    case 'upperRightScript':
    case 'lowerRightScript':
      return 1.08
    case 'upperLeftScript':
    case 'lowerLeftScript':
      return 1.02
    case 'leftInline':
      return 0.9
    case 'over':
    case 'under':
    case 'interior':
      return 1.04
    default:
      return 1
  }
}

const getFieldBounds = (host: StrokeGroup, kind: LegoFieldKind): InkBounds => {
  const width = Math.max(host.bounds.width, 18)
  const height = Math.max(host.bounds.height, 18)
  const scriptWidth = Math.max(24, width * 1.02)
  const scriptHeight = Math.max(20, height * 0.84)
  const inlineWidth = Math.max(22, width * 0.92)
  const inlineHeight = Math.max(18, height * 0.9)
  const hostedWidth = Math.max(28, width * 1.22)
  const hostedHeight = Math.max(22, height * 1.02)

  switch (kind) {
    case 'center':
      return host.bounds
    case 'rightInline':
      return makeBounds(
        host.bounds.right - width * 0.06,
        host.bounds.centerY - inlineHeight / 2,
        host.bounds.right + inlineWidth,
        host.bounds.centerY + inlineHeight / 2,
      )
    case 'leftInline':
      return makeBounds(
        host.bounds.left - inlineWidth,
        host.bounds.centerY - inlineHeight / 2,
        host.bounds.left + width * 0.06,
        host.bounds.centerY + inlineHeight / 2,
      )
    case 'upperRightScript':
      return makeBounds(
        host.bounds.right - width * 0.08,
        host.bounds.top - scriptHeight * 0.88,
        host.bounds.right - width * 0.08 + scriptWidth,
        host.bounds.top + height * 0.34,
      )
    case 'lowerRightScript':
      return makeBounds(
        host.bounds.right - width * 0.08,
        host.bounds.bottom - height * 0.34,
        host.bounds.right - width * 0.08 + scriptWidth,
        host.bounds.bottom - height * 0.34 + scriptHeight,
      )
    case 'upperLeftScript':
      return makeBounds(
        host.bounds.left + width * 0.08 - scriptWidth,
        host.bounds.top - scriptHeight * 0.88,
        host.bounds.left + width * 0.08,
        host.bounds.top + height * 0.34,
      )
    case 'lowerLeftScript':
      return makeBounds(
        host.bounds.left + width * 0.08 - scriptWidth,
        host.bounds.bottom - height * 0.34,
        host.bounds.left + width * 0.08,
        host.bounds.bottom - height * 0.34 + scriptHeight,
      )
    case 'over':
      return makeBounds(
        host.bounds.centerX - hostedWidth / 2,
        host.bounds.top - hostedHeight,
        host.bounds.centerX + hostedWidth / 2,
        host.bounds.top + height * 0.16,
      )
    case 'under':
      return makeBounds(
        host.bounds.centerX - hostedWidth / 2,
        host.bounds.bottom - height * 0.16,
        host.bounds.centerX + hostedWidth / 2,
        host.bounds.bottom + hostedHeight,
      )
    case 'interior':
      return makeBounds(
        host.bounds.left + width * 0.08,
        host.bounds.top + height * 0.08,
        host.bounds.right - width * 0.08,
        host.bounds.bottom - height * 0.08,
      )
    default:
      return host.bounds
  }
}

const buildFieldInstances = (groups: StrokeGroup[], brickHypotheses: LegoBrickHypothesis[]) => {
  const topHypothesisByGroupId = getTopBrickHypothesisByGroupId(brickHypotheses)

  return groups.flatMap<LegoFieldInstance>((group) => {
    const topHypothesis = topHypothesisByGroupId.get(group.id)
    if (!topHypothesis) return []

    return topHypothesis.fields.map((field) => {
      const strength = field.weight * topHypothesis.score
      const ownershipBias = getFieldOwnershipBias(field.kind)
      return {
        id: `field:${group.id}:${field.kind}`,
        hypothesisId: topHypothesis.id,
        hostGroupId: group.id,
        hostFamily: topHypothesis.family,
        hostPrototype: topHypothesis.prototype,
        hypothesisScore: topHypothesis.score,
        kind: field.kind,
        capacity: field.capacity,
        weight: field.weight,
        strength,
        ownershipStrength: strength * ownershipBias,
        bounds: getFieldBounds(group, field.kind),
        evidence: [
          `family=${topHypothesis.family}`,
          `prototype=${topHypothesis.prototype}`,
          `field-weight=${field.weight.toFixed(2)}`,
          `hypothesis-score=${topHypothesis.score.toFixed(2)}`,
          `ownership-bias=${ownershipBias.toFixed(2)}`,
          ...field.evidence,
        ],
      }
    })
  })
}

const buildFieldIntersections = (fieldInstances: LegoFieldInstance[]) => {
  const intersections: LegoFieldIntersection[] = []

  for (let leftIndex = 0; leftIndex < fieldInstances.length; leftIndex += 1) {
    const left = fieldInstances[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < fieldInstances.length; rightIndex += 1) {
      const right = fieldInstances[rightIndex]
      if (left.hostGroupId === right.hostGroupId) continue

      const bounds = getBoundsIntersection(left.bounds, right.bounds)
      if (!bounds) continue

      const overlapArea = getBoundsArea(bounds)
      if (overlapArea <= 0) continue

      const overlapRatio = overlapArea / Math.max(1, Math.min(getBoundsArea(left.bounds), getBoundsArea(right.bounds)))
      if (overlapRatio < 0.04) continue

      const leftScore = left.ownershipStrength
      const rightScore = right.ownershipStrength
      const dominantField = leftScore === rightScore ? null : leftScore > rightScore ? left : right

      intersections.push({
        id: `intersection:${left.id}:${right.id}`,
        leftFieldId: left.id,
        rightFieldId: right.id,
        leftHostGroupId: left.hostGroupId,
        rightHostGroupId: right.hostGroupId,
        leftKind: left.kind,
        rightKind: right.kind,
        bounds,
        overlapArea,
        overlapRatio,
        dominantFieldId: dominantField?.id || null,
        dominantHostGroupId: dominantField?.hostGroupId || null,
        dominantKind: dominantField?.kind || null,
        dominanceMargin: Math.abs(leftScore - rightScore),
        evidence: [
          `left-strength=${left.ownershipStrength.toFixed(3)}`,
          `right-strength=${right.ownershipStrength.toFixed(3)}`,
          `overlap-ratio=${overlapRatio.toFixed(3)}`,
          dominantField ? `dominant=${dominantField.hostGroupId}:${dominantField.kind}` : 'dominant=tie',
        ],
      })
    }
  }

  return intersections
}

const buildFieldClaims = (
  groups: StrokeGroup[],
  fieldInstances: LegoFieldInstance[],
  fieldIntersections: LegoFieldIntersection[],
) => {
  const intersectionsByFieldId = new Map<string, LegoFieldIntersection[]>()

  for (const intersection of fieldIntersections) {
    const leftBucket = intersectionsByFieldId.get(intersection.leftFieldId) || []
    leftBucket.push(intersection)
    intersectionsByFieldId.set(intersection.leftFieldId, leftBucket)

    const rightBucket = intersectionsByFieldId.get(intersection.rightFieldId) || []
    rightBucket.push(intersection)
    intersectionsByFieldId.set(intersection.rightFieldId, rightBucket)
  }

  const claims: LegoFieldClaim[] = []

  for (const target of groups) {
    for (const field of fieldInstances) {
      if (field.hostGroupId === target.id) continue

      const overlapBounds = getBoundsIntersection(target.bounds, field.bounds)
      const overlapArea = overlapBounds ? getBoundsArea(overlapBounds) : 0
      const overlapRatio = overlapArea / Math.max(1, Math.min(getBoundsArea(target.bounds), getBoundsArea(field.bounds)))
      const centerInside = isPointInsideBounds(target.centroid.x, target.centroid.y, field.bounds)
      const distanceScore = getDistanceScoreToBoundsCenter(target.centroid.x, target.centroid.y, field.bounds)

      let dominanceBoost = 0
      for (const intersection of intersectionsByFieldId.get(field.id) || []) {
        const targetIntersection = getBoundsIntersection(target.bounds, intersection.bounds)
        if (!targetIntersection) continue
        const targetOverlapRatio = getBoundsArea(targetIntersection) / Math.max(1, getBoundsArea(target.bounds))
        if (intersection.dominantFieldId === field.id) {
          dominanceBoost = Math.max(dominanceBoost, targetOverlapRatio * 0.22 + intersection.overlapRatio * 0.08)
        } else if (intersection.dominantFieldId) {
          dominanceBoost = Math.max(dominanceBoost, -targetOverlapRatio * 0.12)
        }
      }

      const rawScore = field.ownershipStrength * 0.46 + overlapRatio * 0.28 + (centerInside ? 0.16 : 0) + distanceScore * 0.1 + dominanceBoost
      const score = clamp(rawScore, 0, 1.4)
      if (score < 0.34) continue

      claims.push({
        id: `claim:${target.id}:${field.id}`,
        targetGroupId: target.id,
        fieldId: field.id,
        hostGroupId: field.hostGroupId,
        hostFamily: field.hostFamily,
        fieldKind: field.kind,
        score,
        overlapRatio,
        centerInside,
        distanceScore,
        dominanceBoost,
        ownershipStrength: field.ownershipStrength,
        evidence: [
          `ownership-strength=${field.ownershipStrength.toFixed(3)}`,
          `overlap-ratio=${overlapRatio.toFixed(3)}`,
          `center-inside=${centerInside}`,
          `distance-score=${distanceScore.toFixed(3)}`,
          `dominance-boost=${dominanceBoost.toFixed(3)}`,
        ],
      })
    }
  }

  return claims.sort((left, right) => (
    right.score - left.score
    || right.overlapRatio - left.overlapRatio
    || left.targetGroupId.localeCompare(right.targetGroupId)
  ))
}

export const buildConcreteLegoFieldLayer = (
  groups: StrokeGroup[],
  brickHypotheses: LegoBrickHypothesis[],
): FieldLayer => {
  const fieldInstances = buildFieldInstances(groups, brickHypotheses)
  const fieldIntersections = buildFieldIntersections(fieldInstances)
  const fieldClaims = buildFieldClaims(groups, fieldInstances, fieldIntersections)

  return {
    fieldInstances,
    fieldIntersections,
    fieldClaims,
  }
}
