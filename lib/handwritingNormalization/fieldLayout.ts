import { clamp } from './geometry'
import { getTopBrickHypothesisByGroupId } from './legoModel'
import type {
  InkBounds,
  LegoBrickHypothesis,
  LegoFieldBoundaryState,
  LegoFieldBoundarySource,
  LegoFieldClaim,
  LegoFieldDirection,
  LegoFieldInstance,
  LegoFieldInteractionKind,
  LegoFieldIntersection,
  LegoFieldKind,
  LegoFieldSide,
  LegoFieldTopology,
  StrokeGroup,
} from './types'

type FieldLayer = {
  fieldInstances: LegoFieldInstance[]
  fieldIntersections: LegoFieldIntersection[]
  fieldClaims: LegoFieldClaim[]
}

type HostShapeProfile = {
  horizontalLineLike: boolean
  verticalLineLike: boolean
  lineLike: boolean
  width: number
  height: number
}

type FieldGeometryProfile = {
  direction: LegoFieldDirection
  topology: LegoFieldTopology
  boundaryState: LegoFieldBoundaryState
  openSides: LegoFieldSide[]
  closureRatio: number
  innerClosureRatio: number
  outerClosureRatio: number
  counterpartKinds: LegoFieldKind[]
}

const ALL_FIELD_KINDS: LegoFieldKind[] = [
  'center',
  'leftInline',
  'rightInline',
  'upperLeftScript',
  'upperRightScript',
  'lowerLeftScript',
  'lowerRightScript',
  'over',
  'under',
  'interior',
]

const DEFAULT_FIELD_CAPACITY: Record<LegoFieldKind, LegoFieldInstance['capacity']> = {
  center: 'single',
  leftInline: 'sequence',
  rightInline: 'sequence',
  upperLeftScript: 'stackable',
  upperRightScript: 'stackable',
  lowerLeftScript: 'stackable',
  lowerRightScript: 'stackable',
  over: 'hostedRegion',
  under: 'hostedRegion',
  interior: 'hostedRegion',
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

const makeDegenerateBoundaryState = (): LegoFieldBoundaryState => ({
  top: 'degenerate',
  right: 'degenerate',
  bottom: 'degenerate',
  left: 'degenerate',
})

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

const FIELD_DIRECTION_BY_KIND: Record<LegoFieldKind, LegoFieldDirection> = {
  center: 'neutral',
  leftInline: 'incoming',
  rightInline: 'outgoing',
  upperLeftScript: 'incoming',
  upperRightScript: 'outgoing',
  lowerLeftScript: 'incoming',
  lowerRightScript: 'outgoing',
  over: 'hosted',
  under: 'hosted',
  interior: 'interior',
}

const COUNTERPART_FIELD_KINDS: Record<LegoFieldKind, LegoFieldKind[]> = {
  center: [],
  leftInline: ['rightInline'],
  rightInline: ['leftInline'],
  upperLeftScript: ['upperRightScript'],
  upperRightScript: ['upperLeftScript'],
  lowerLeftScript: ['lowerRightScript'],
  lowerRightScript: ['lowerLeftScript'],
  over: [],
  under: [],
  interior: [],
}

const getFieldOwnershipBias = (kind: LegoFieldKind) => {
  switch (kind) {
    case 'upperRightScript':
    case 'lowerRightScript':
      return 1.1
    case 'upperLeftScript':
    case 'lowerLeftScript':
      return 0.92
    case 'rightInline':
    case 'leftInline':
      return 0.94
    case 'over':
    case 'under':
    case 'interior':
      return 1.04
    default:
      return 1
  }
}

const getInteractionKind = (leftKind: LegoFieldKind, rightKind: LegoFieldKind): LegoFieldInteractionKind => {
  if (COUNTERPART_FIELD_KINDS[leftKind].includes(rightKind) || COUNTERPART_FIELD_KINDS[rightKind].includes(leftKind)) {
    return 'cooperative'
  }

  const leftDirection = FIELD_DIRECTION_BY_KIND[leftKind]
  const rightDirection = FIELD_DIRECTION_BY_KIND[rightKind]
  const sameScriptBand = (
    (leftKind === 'upperRightScript' || leftKind === 'upperLeftScript' || leftKind === 'lowerRightScript' || leftKind === 'lowerLeftScript')
    && (rightKind === 'upperRightScript' || rightKind === 'upperLeftScript' || rightKind === 'lowerRightScript' || rightKind === 'lowerLeftScript')
  )

  if ((leftDirection === rightDirection && leftDirection !== 'neutral') || sameScriptBand) {
    return 'competitive'
  }

  return 'neutral'
}

const getHostShapeProfile = (host: StrokeGroup, hypothesis: LegoBrickHypothesis): HostShapeProfile => {
  const width = Math.max(host.bounds.width, 1)
  const height = Math.max(host.bounds.height, 1)
  const horizontalLineLike = hypothesis.prototype === 'horizontalLine'
    || hypothesis.family === 'fractionBarBrick'
    || height <= Math.max(10, width * 0.18)
  const verticalLineLike = hypothesis.family === 'enclosureBoundaryBrick'
    || (hypothesis.prototype === 'boundaryStroke' && width <= Math.max(10, height * 0.18))
  return {
    horizontalLineLike,
    verticalLineLike,
    lineLike: horizontalLineLike || verticalLineLike,
    width,
    height,
  }
}

const getFieldBoundaryState = (kind: LegoFieldKind, profile: HostShapeProfile): LegoFieldBoundaryState => {
  if (profile.horizontalLineLike && (kind === 'upperLeftScript' || kind === 'upperRightScript' || kind === 'lowerLeftScript' || kind === 'lowerRightScript' || kind === 'interior')) {
    return makeDegenerateBoundaryState()
  }
  if (profile.verticalLineLike && (kind === 'upperLeftScript' || kind === 'upperRightScript' || kind === 'lowerLeftScript' || kind === 'lowerRightScript' || kind === 'interior')) {
    return makeDegenerateBoundaryState()
  }

  switch (kind) {
    case 'center':
    case 'interior':
      return { top: 'inner', right: 'inner', bottom: 'inner', left: 'inner' }
    case 'rightInline':
      return profile.verticalLineLike
        ? { top: 'outer', right: 'open', bottom: 'outer', left: 'degenerate' }
        : { top: 'outer', right: 'open', bottom: 'outer', left: 'inner' }
    case 'leftInline':
      return profile.verticalLineLike
        ? { top: 'outer', right: 'degenerate', bottom: 'outer', left: 'open' }
        : { top: 'outer', right: 'inner', bottom: 'outer', left: 'open' }
    case 'upperRightScript':
      return { top: 'outer', right: 'open', bottom: 'inner', left: 'inner' }
    case 'lowerRightScript':
      return { top: 'inner', right: 'open', bottom: 'outer', left: 'inner' }
    case 'upperLeftScript':
      return { top: 'outer', right: 'inner', bottom: 'inner', left: 'open' }
    case 'lowerLeftScript':
      return { top: 'inner', right: 'inner', bottom: 'outer', left: 'open' }
    case 'over':
      return profile.horizontalLineLike
        ? { top: 'open', right: 'outer', bottom: 'inner', left: 'outer' }
        : { top: 'open', right: 'outer', bottom: 'inner', left: 'outer' }
    case 'under':
      return profile.horizontalLineLike
        ? { top: 'inner', right: 'outer', bottom: 'open', left: 'outer' }
        : { top: 'inner', right: 'outer', bottom: 'open', left: 'outer' }
    default:
      return { top: 'inner', right: 'inner', bottom: 'inner', left: 'inner' }
  }
}

const getFieldTopology = (kind: LegoFieldKind, profile: HostShapeProfile): LegoFieldTopology => {
  if (profile.horizontalLineLike) {
    if (kind === 'upperLeftScript' || kind === 'upperRightScript' || kind === 'lowerLeftScript' || kind === 'lowerRightScript' || kind === 'interior') return 'degenerate'
    if (kind === 'over' || kind === 'under') return 'unbounded'
  }
  if (profile.verticalLineLike) {
    if (kind === 'upperLeftScript' || kind === 'upperRightScript' || kind === 'lowerLeftScript' || kind === 'lowerRightScript' || kind === 'interior') return 'degenerate'
    if (kind === 'leftInline' || kind === 'rightInline') return 'unbounded'
  }
  if (kind === 'center' || kind === 'interior') return 'bounded'
  return 'semiBounded'
}

const getClosureRatios = (boundaryState: LegoFieldBoundaryState, topology: LegoFieldTopology) => {
  if (topology === 'degenerate' || topology === 'forbidden') {
    return { closureRatio: 0, innerClosureRatio: 0, outerClosureRatio: 0, openSides: ['top', 'right', 'bottom', 'left'] as LegoFieldSide[] }
  }

  const entries = Object.entries(boundaryState) as Array<[LegoFieldSide, LegoFieldBoundarySource]>
  const openSides = entries.filter(([, source]) => source === 'open').map(([side]) => side)
  const innerClosureRatio = entries.filter(([, source]) => source === 'inner').length / 4
  const outerClosureRatio = entries.filter(([, source]) => source === 'outer').length / 4
  const closureRatio = clamp(innerClosureRatio + outerClosureRatio, 0, topology === 'bounded' ? 1 : topology === 'semiBounded' ? 0.75 : 0.5)
  return { closureRatio, innerClosureRatio, outerClosureRatio, openSides }
}

const getFieldGeometryProfile = (host: StrokeGroup, hypothesis: LegoBrickHypothesis, kind: LegoFieldKind): FieldGeometryProfile => {
  const shapeProfile = getHostShapeProfile(host, hypothesis)
  const direction = FIELD_DIRECTION_BY_KIND[kind]
  const topology = getFieldTopology(kind, shapeProfile)
  const boundaryState = getFieldBoundaryState(kind, shapeProfile)
  const { closureRatio, innerClosureRatio, outerClosureRatio, openSides } = getClosureRatios(boundaryState, topology)

  return {
    direction,
    topology,
    boundaryState,
    openSides,
    closureRatio,
    innerClosureRatio,
    outerClosureRatio,
    counterpartKinds: COUNTERPART_FIELD_KINDS[kind],
  }
}

const getFieldBounds = (host: StrokeGroup, hypothesis: LegoBrickHypothesis, profile: FieldGeometryProfile, kind: LegoFieldKind): InkBounds => {
  const width = Math.max(host.bounds.width, 18)
  const height = Math.max(host.bounds.height, 18)
  const scriptWidth = Math.max(18, width * 0.78)
  const scriptHeight = Math.max(16, height * 0.78)
  const inlineWidth = Math.max(18, width * 0.82)
  const inlineHeight = Math.max(16, height * 0.84)
  const hostedWidth = Math.max(24, width * 1.08)
  const hostedHeight = Math.max(18, height * 0.96)
  const unboundedWidth = Math.max(42, width * 1.24, height * 0.7)
  const unboundedHeight = Math.max(42, height * 2.1, width * 0.72)

  if (profile.topology === 'degenerate') {
    switch (kind) {
      case 'upperRightScript':
        return makeBounds(host.bounds.right, host.bounds.top, host.bounds.right, host.bounds.top)
      case 'lowerRightScript':
        return makeBounds(host.bounds.right, host.bounds.bottom, host.bounds.right, host.bounds.bottom)
      case 'upperLeftScript':
        return makeBounds(host.bounds.left, host.bounds.top, host.bounds.left, host.bounds.top)
      case 'lowerLeftScript':
        return makeBounds(host.bounds.left, host.bounds.bottom, host.bounds.left, host.bounds.bottom)
      case 'interior':
        return makeBounds(host.bounds.centerX, host.bounds.centerY, host.bounds.centerX, host.bounds.centerY)
      default:
        return makeBounds(host.bounds.centerX, host.bounds.centerY, host.bounds.centerX, host.bounds.centerY)
    }
  }

  if (profile.topology === 'unbounded') {
    switch (kind) {
      case 'over':
        return makeBounds(
          host.bounds.centerX - hostedWidth / 2,
          host.bounds.top - unboundedHeight,
          host.bounds.centerX + hostedWidth / 2,
          host.bounds.top + Math.max(8, height * 0.14),
        )
      case 'under':
        return makeBounds(
          host.bounds.centerX - hostedWidth / 2,
          host.bounds.bottom - Math.max(8, height * 0.14),
          host.bounds.centerX + hostedWidth / 2,
          host.bounds.bottom + unboundedHeight,
        )
      case 'leftInline':
        return makeBounds(
          host.bounds.left - unboundedWidth,
          host.bounds.centerY - inlineHeight / 2,
          host.bounds.left + Math.max(4, width * 0.06),
          host.bounds.centerY + inlineHeight / 2,
        )
      case 'rightInline':
        return makeBounds(
          host.bounds.right - Math.max(4, width * 0.06),
          host.bounds.centerY - inlineHeight / 2,
          host.bounds.right + unboundedWidth,
          host.bounds.centerY + inlineHeight / 2,
        )
      default:
        break
    }
  }

  if (hypothesis.family === 'radicalBrick') {
    switch (kind) {
      case 'interior':
        return makeBounds(
          host.bounds.left + Math.max(12, width * 0.26),
          host.bounds.top - Math.max(8, height * 0.08),
          host.bounds.right + Math.max(28, width * 0.92),
          host.bounds.bottom - Math.max(4, height * 0.12),
        )
      case 'upperLeftScript':
        return makeBounds(
          host.bounds.left - Math.max(20, width * 0.5),
          host.bounds.top - Math.max(18, height * 0.34),
          host.bounds.left + Math.max(6, width * 0.08),
          host.bounds.top + Math.max(8, height * 0.18),
        )
      case 'upperRightScript':
      case 'lowerRightScript': {
        const verticalTop = kind === 'upperRightScript'
          ? host.bounds.top - Math.max(18, height * 0.42)
          : host.bounds.bottom - Math.max(8, height * 0.18)
        const verticalBottom = kind === 'upperRightScript'
          ? host.bounds.top + Math.max(10, height * 0.12)
          : host.bounds.bottom + Math.max(18, height * 0.42)
        return makeBounds(
          host.bounds.right + Math.max(10, width * 0.08),
          verticalTop,
          host.bounds.right + Math.max(34, width * 0.62),
          verticalBottom,
        )
      }
      default:
        break
    }
  }

  switch (kind) {
    case 'center':
      return host.bounds
    case 'rightInline':
      return makeBounds(
        host.bounds.right - width * 0.04,
        host.bounds.centerY - inlineHeight / 2,
        host.bounds.right + inlineWidth,
        host.bounds.centerY + inlineHeight / 2,
      )
    case 'leftInline':
      return makeBounds(
        host.bounds.left - inlineWidth,
        host.bounds.centerY - inlineHeight / 2,
        host.bounds.left + width * 0.04,
        host.bounds.centerY + inlineHeight / 2,
      )
    case 'upperRightScript':
      return makeBounds(
        host.bounds.right - width * 0.06,
        host.bounds.top - scriptHeight * 0.94,
        host.bounds.right - width * 0.06 + scriptWidth,
        host.bounds.top + height * 0.26,
      )
    case 'lowerRightScript':
      return makeBounds(
        host.bounds.right - width * 0.06,
        host.bounds.bottom - height * 0.26,
        host.bounds.right - width * 0.06 + scriptWidth,
        host.bounds.bottom - height * 0.26 + scriptHeight,
      )
    case 'upperLeftScript':
      return makeBounds(
        host.bounds.left + width * 0.06 - scriptWidth,
        host.bounds.top - scriptHeight * 0.94,
        host.bounds.left + width * 0.06,
        host.bounds.top + height * 0.26,
      )
    case 'lowerLeftScript':
      return makeBounds(
        host.bounds.left + width * 0.06 - scriptWidth,
        host.bounds.bottom - height * 0.26,
        host.bounds.left + width * 0.06,
        host.bounds.bottom - height * 0.26 + scriptHeight,
      )
    case 'over':
      return makeBounds(
        host.bounds.centerX - hostedWidth / 2,
        host.bounds.top - hostedHeight,
        host.bounds.centerX + hostedWidth / 2,
        host.bounds.top + height * 0.12,
      )
    case 'under':
      return makeBounds(
        host.bounds.centerX - hostedWidth / 2,
        host.bounds.bottom - height * 0.12,
        host.bounds.centerX + hostedWidth / 2,
        host.bounds.bottom + hostedHeight,
      )
    case 'interior':
      return makeBounds(
        host.bounds.left + width * 0.1,
        host.bounds.top + height * 0.1,
        host.bounds.right - width * 0.1,
        host.bounds.bottom - height * 0.1,
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

    return ALL_FIELD_KINDS.map((kind) => {
      const declaredField = topHypothesis.fields.find((field) => field.kind === kind) || null
      const geometryProfile = getFieldGeometryProfile(group, topHypothesis, kind)
      const topologyWeight = geometryProfile.topology === 'bounded'
        ? 1
        : geometryProfile.topology === 'semiBounded'
          ? 0.84
          : geometryProfile.topology === 'unbounded'
            ? 0.62
            : 0
      const weight = declaredField?.weight || 0
      const capacity = declaredField?.capacity || DEFAULT_FIELD_CAPACITY[kind]
      const strength = weight * topHypothesis.score
      const ownershipBias = getFieldOwnershipBias(kind)
      const bounds = getFieldBounds(group, topHypothesis, geometryProfile, kind)
      return {
        id: `field:${group.id}:${kind}`,
        hypothesisId: topHypothesis.id,
        hostGroupId: group.id,
        hostFamily: topHypothesis.family,
        hostPrototype: topHypothesis.prototype,
        hypothesisScore: topHypothesis.score,
        kind,
        capacity,
        direction: geometryProfile.direction,
        topology: geometryProfile.topology,
        weight,
        strength,
        ownershipStrength: strength * ownershipBias * (0.46 + geometryProfile.closureRatio * 0.54) * topologyWeight,
        bounds,
        realizedArea: getBoundsArea(bounds),
        closureRatio: geometryProfile.closureRatio,
        innerClosureRatio: geometryProfile.innerClosureRatio,
        outerClosureRatio: geometryProfile.outerClosureRatio,
        openSides: geometryProfile.openSides,
        boundaryState: geometryProfile.boundaryState,
        counterpartKinds: geometryProfile.counterpartKinds,
        evidence: [
          `family=${topHypothesis.family}`,
          `prototype=${topHypothesis.prototype}`,
          `field-weight=${weight.toFixed(2)}`,
          `hypothesis-score=${topHypothesis.score.toFixed(2)}`,
          `ownership-bias=${ownershipBias.toFixed(2)}`,
          `topology=${geometryProfile.topology}`,
          `direction=${geometryProfile.direction}`,
          `closure=${geometryProfile.closureRatio.toFixed(2)}`,
          `inner-closure=${geometryProfile.innerClosureRatio.toFixed(2)}`,
          `outer-closure=${geometryProfile.outerClosureRatio.toFixed(2)}`,
          geometryProfile.openSides.length ? `open-sides=${geometryProfile.openSides.join(',')}` : 'open-sides=none',
          declaredField ? 'field-source=declared' : 'field-source=implicit-skeleton',
          ...(declaredField?.evidence || []),
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
      if (left.topology === 'degenerate' || right.topology === 'degenerate') continue

      const bounds = getBoundsIntersection(left.bounds, right.bounds)
      if (!bounds) continue

      const overlapArea = getBoundsArea(bounds)
      if (overlapArea <= 0) continue

      const overlapRatio = overlapArea / Math.max(1, Math.min(Math.max(getBoundsArea(left.bounds), 1), Math.max(getBoundsArea(right.bounds), 1)))
      if (overlapRatio < 0.04) continue

      const interactionKind = getInteractionKind(left.kind, right.kind)
      const cooperativeScore = interactionKind === 'cooperative'
        ? clamp(Math.sqrt(Math.max(left.ownershipStrength, 0) * Math.max(right.ownershipStrength, 0)) * 0.58 + overlapRatio * 0.42, 0, 1)
        : 0
      const competitiveScore = interactionKind === 'competitive'
        ? clamp(Math.max(left.ownershipStrength, right.ownershipStrength) * 0.52 + overlapRatio * 0.48, 0, 1)
        : 0
      const leftScore = left.ownershipStrength * (0.54 + left.closureRatio * 0.26) + (interactionKind === 'cooperative' ? cooperativeScore * 0.08 : competitiveScore * 0.12)
      const rightScore = right.ownershipStrength * (0.54 + right.closureRatio * 0.26) + (interactionKind === 'cooperative' ? cooperativeScore * 0.08 : competitiveScore * 0.12)
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
        interactionKind,
        cooperativeScore,
        competitiveScore,
        dominantFieldId: dominantField?.id || null,
        dominantHostGroupId: dominantField?.hostGroupId || null,
        dominantKind: dominantField?.kind || null,
        dominanceMargin: Math.abs(leftScore - rightScore),
        evidence: [
          `interaction=${interactionKind}`,
          `left-strength=${left.ownershipStrength.toFixed(3)}`,
          `right-strength=${right.ownershipStrength.toFixed(3)}`,
          `overlap-ratio=${overlapRatio.toFixed(3)}`,
          `cooperative-score=${cooperativeScore.toFixed(3)}`,
          `competitive-score=${competitiveScore.toFixed(3)}`,
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
  const intersectionsByPairId = new Map<string, LegoFieldIntersection>()
  const fieldInstancesByHostGroupId = new Map<string, LegoFieldInstance[]>()

  for (const field of fieldInstances) {
    const bucket = fieldInstancesByHostGroupId.get(field.hostGroupId) || []
    bucket.push(field)
    fieldInstancesByHostGroupId.set(field.hostGroupId, bucket)
  }

  for (const intersection of fieldIntersections) {
    const leftBucket = intersectionsByFieldId.get(intersection.leftFieldId) || []
    leftBucket.push(intersection)
    intersectionsByFieldId.set(intersection.leftFieldId, leftBucket)

    const rightBucket = intersectionsByFieldId.get(intersection.rightFieldId) || []
    rightBucket.push(intersection)
    intersectionsByFieldId.set(intersection.rightFieldId, rightBucket)

    intersectionsByPairId.set(`${intersection.leftFieldId}|${intersection.rightFieldId}`, intersection)
    intersectionsByPairId.set(`${intersection.rightFieldId}|${intersection.leftFieldId}`, intersection)
  }

  const claims: LegoFieldClaim[] = []

  for (const target of groups) {
    const targetFields = fieldInstancesByHostGroupId.get(target.id) || []

    for (const field of fieldInstances) {
      if (field.hostGroupId === target.id) continue
      if (field.kind === 'center') continue
      if (field.topology === 'degenerate' || field.topology === 'forbidden') continue

      const overlapBounds = getBoundsIntersection(target.bounds, field.bounds)
      const overlapArea = overlapBounds ? getBoundsArea(overlapBounds) : 0
      const overlapRatio = overlapArea / Math.max(1, Math.min(getBoundsArea(target.bounds), Math.max(getBoundsArea(field.bounds), 1)))
      const centerInside = isPointInsideBounds(target.centroid.x, target.centroid.y, field.bounds)
      const distanceScore = getDistanceScoreToBoundsCenter(target.centroid.x, target.centroid.y, field.bounds)

      let dominanceBoost = 0
      for (const intersection of intersectionsByFieldId.get(field.id) || []) {
        const targetIntersection = getBoundsIntersection(target.bounds, intersection.bounds)
        if (!targetIntersection) continue
        const targetOverlapRatio = getBoundsArea(targetIntersection) / Math.max(1, getBoundsArea(target.bounds))
        if (intersection.interactionKind === 'competitive' && intersection.dominantFieldId === field.id) {
          dominanceBoost = Math.max(dominanceBoost, targetOverlapRatio * 0.18 + intersection.overlapRatio * 0.08)
        } else if (intersection.interactionKind === 'competitive' && intersection.dominantFieldId) {
          dominanceBoost = Math.max(dominanceBoost, -targetOverlapRatio * 0.1)
        }
      }

      const counterpartField = targetFields
        .filter((candidate) => field.counterpartKinds.includes(candidate.kind))
        .sort((left, right) => {
          const leftScore = left.ownershipStrength * (0.52 + left.closureRatio * 0.48)
          const rightScore = right.ownershipStrength * (0.52 + right.closureRatio * 0.48)
          return rightScore - leftScore
        })[0] || null
      const counterpartIntersection = counterpartField ? intersectionsByPairId.get(`${field.id}|${counterpartField.id}`) || null : null
      const directionalCompatibilityScore = counterpartField
        ? clamp(
          counterpartField.ownershipStrength * 0.46
            + counterpartField.closureRatio * 0.24
            + (COUNTERPART_FIELD_KINDS[field.kind].includes(counterpartField.kind) ? 0.2 : 0)
            + ((counterpartField.direction === 'incoming' && field.direction === 'outgoing') || (counterpartField.direction === 'outgoing' && field.direction === 'incoming') ? 0.1 : 0),
          0,
          1,
        )
        : 0
      const sharedCompatibilityScore = counterpartIntersection?.interactionKind === 'cooperative'
        ? counterpartIntersection.cooperativeScore
        : 0
      const lineLikeTarget = target.strokeCount === 1 && target.bounds.width >= Math.max(24, target.bounds.height * 2.4)
      const targetVerticalOffset = target.centroid.y - field.bounds.centerY
      const lineLikeReceptionBoost = lineLikeTarget && (
        (field.kind === 'upperRightScript' && targetVerticalOffset <= -Math.max(14, target.bounds.height * 0.8))
        || (field.kind === 'lowerRightScript' && targetVerticalOffset >= Math.max(14, target.bounds.height * 0.8))
      )
        ? 0.12
        : 0
      const radicalInteriorField = field.hostFamily === 'radicalBrick'
        ? fieldInstancesByHostGroupId.get(field.hostGroupId)?.find((candidate) => candidate.kind === 'interior') || null
        : null
      const targetInRadicalInterior = radicalInteriorField ? isPointInsideBounds(target.centroid.x, target.centroid.y, radicalInteriorField.bounds) : false
      const radicalHostedSuppression = field.hostFamily === 'radicalBrick'
        && (field.kind === 'upperRightScript' || field.kind === 'lowerRightScript')
        && targetInRadicalInterior
          ? 0.18
          : 0
      const latentPenalty = field.topology === 'semiBounded'
        ? counterpartField ? 0 : 0.12
        : field.topology === 'unbounded'
          ? counterpartField ? 0.04 : 0.16
          : 0
      const realizationScore = clamp(
        field.closureRatio * 0.22
          + overlapRatio * 0.16
          + (centerInside ? 0.1 : 0)
          + distanceScore * 0.08
          + directionalCompatibilityScore * 0.22
          + sharedCompatibilityScore * 0.18
          + lineLikeReceptionBoost
          + (counterpartField ? counterpartField.closureRatio * 0.04 : 0)
          - latentPenalty
          - radicalHostedSuppression,
        0,
        1,
      )

      const rawScore = field.ownershipStrength * 0.3
        + overlapRatio * 0.18
        + (centerInside ? 0.12 : 0)
        + distanceScore * 0.08
        + dominanceBoost
        + realizationScore * 0.22
        + directionalCompatibilityScore * 0.08
        + sharedCompatibilityScore * 0.08
        + lineLikeReceptionBoost
        - latentPenalty
        - radicalHostedSuppression
      const score = clamp(rawScore, 0, 1.4)
      if (score < 0.26) continue

      claims.push({
        id: `claim:${target.id}:${field.id}`,
        targetGroupId: target.id,
        fieldId: field.id,
        hostGroupId: field.hostGroupId,
        hostFamily: field.hostFamily,
        fieldKind: field.kind,
        fieldDirection: field.direction,
        fieldTopology: field.topology,
        score,
        overlapRatio,
        centerInside,
        distanceScore,
        dominanceBoost,
        ownershipStrength: field.ownershipStrength,
        closureRatio: field.closureRatio,
        realizationScore,
        directionalCompatibilityScore,
        sharedCompatibilityScore,
        latentPenalty,
        counterpartFieldKind: counterpartField?.kind || null,
        counterpartFieldScore: counterpartField ? counterpartField.ownershipStrength : 0,
        counterpartFieldTopology: counterpartField?.topology || null,
        evidence: [
          `ownership-strength=${field.ownershipStrength.toFixed(3)}`,
          `field-topology=${field.topology}`,
          `field-direction=${field.direction}`,
          `field-closure=${field.closureRatio.toFixed(3)}`,
          `overlap-ratio=${overlapRatio.toFixed(3)}`,
          `center-inside=${centerInside}`,
          `distance-score=${distanceScore.toFixed(3)}`,
          `dominance-boost=${dominanceBoost.toFixed(3)}`,
          `realization-score=${realizationScore.toFixed(3)}`,
          `directional-compatibility=${directionalCompatibilityScore.toFixed(3)}`,
          `shared-compatibility=${sharedCompatibilityScore.toFixed(3)}`,
          `line-like-reception=${lineLikeReceptionBoost.toFixed(3)}`,
          `radical-hosted-suppression=${radicalHostedSuppression.toFixed(3)}`,
          `latent-penalty=${latentPenalty.toFixed(3)}`,
          `counterpart-field=${counterpartField?.kind || 'none'}`,
          `counterpart-topology=${counterpartField?.topology || 'none'}`,
          `counterpart-score=${(counterpartField?.ownershipStrength || 0).toFixed(3)}`,
        ],
      })
    }
  }

  return claims.sort((left, right) => (
    right.score - left.score
    || right.realizationScore - left.realizationScore
    || right.sharedCompatibilityScore - left.sharedCompatibilityScore
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