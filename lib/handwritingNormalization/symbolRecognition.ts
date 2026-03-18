import type { InkBounds, InkStroke, RecognizedSymbol, StrokeGroup, StructuralRole } from './types'

const clampConfidence = (value: number) => Math.max(0, Math.min(0.99, value))

const makeSymbol = (category: RecognizedSymbol['category'], value: string, confidence: number, evidence: string[]): RecognizedSymbol => ({
  category,
  value,
  confidence: clampConfidence(confidence),
  evidence,
})

const getStrokeEndpoints = (stroke: InkStroke) => {
  const first = stroke.points[0]
  const last = stroke.points[stroke.points.length - 1]
  return { first, last }
}

const getGroupStrokes = (group: StrokeGroup) => group.strokes || []

const getGroupStrokeCount = (group: StrokeGroup) => getGroupStrokes(group).length

const getStrokeBounds = (stroke: InkStroke): InkBounds => {
  const xs = stroke.points.map((point) => point.x)
  const ys = stroke.points.map((point) => point.y)
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  }
}

const isHorizontalStroke = (stroke: InkStroke) => {
  const bounds = getStrokeBounds(stroke)
  return bounds.width >= Math.max(18, bounds.height * 1.8)
}

const isVerticalStroke = (stroke: InkStroke) => {
  const bounds = getStrokeBounds(stroke)
  return bounds.height >= Math.max(18, bounds.width * 1.8)
}

const getStrokeSlopeKind = (stroke: InkStroke) => {
  const { first, last } = getStrokeEndpoints(stroke)
  const dx = (last?.x || 0) - (first?.x || 0)
  const dy = (last?.y || 0) - (first?.y || 0)
  if (Math.abs(dx) < 1 || Math.abs(dy) < 1) return 'flat'
  return dx * dy >= 0 ? 'positive' : 'negative'
}

const recognizeStructuralSymbol = (role: StructuralRole) => {
  if (role.role === 'fractionBar') {
    return makeSymbol('structure', 'fraction-bar', 0.99, ['structural fraction bar role'])
  }
  if (role.role === 'enclosureOpen') {
    return makeSymbol('encloser', '(', 0.99, ['structural enclosure-open role'])
  }
  if (role.role === 'enclosureClose') {
    return makeSymbol('encloser', ')', 0.99, ['structural enclosure-close role'])
  }
  return null
}

const recognizePlus = (group: StrokeGroup) => {
  if (getGroupStrokeCount(group) !== 2) return null
  const strokes = getGroupStrokes(group)
  const horizontal = strokes.find(isHorizontalStroke)
  const vertical = strokes.find(isVerticalStroke)
  if (!horizontal || !vertical) return null
  const horizontalBounds = getStrokeBounds(horizontal)
  const verticalBounds = getStrokeBounds(vertical)
  const centerDistance = Math.abs(horizontalBounds.centerX - verticalBounds.centerX) + Math.abs(horizontalBounds.centerY - verticalBounds.centerY)
  if (centerDistance > Math.max(16, (group.bounds.width + group.bounds.height) * 0.18)) return null
  return makeSymbol('operator', '+', 0.95, ['one horizontal stroke crosses one vertical stroke near the group center'])
}

const recognizeX = (group: StrokeGroup) => {
  if (getGroupStrokeCount(group) !== 2) return null
  const slopes = getGroupStrokes(group).map(getStrokeSlopeKind)
  if (!slopes.includes('positive') || !slopes.includes('negative')) return null
  return makeSymbol('latin', 'x', 0.9, ['two diagonal strokes cross with opposing slopes'])
}

const recognizeFour = (group: StrokeGroup) => {
  if (getGroupStrokeCount(group) !== 2) return null
  const strokes = getGroupStrokes(group)
  const hasVertical = strokes.some(isVerticalStroke)
  const bentStroke = strokes.find((stroke) => stroke.points.length >= 3)
  if (!hasVertical || !bentStroke) return null
  return makeSymbol('digit', '4', 0.88, ['one vertical stroke combines with a bent crossing stroke'])
}

const recognizeV = (group: StrokeGroup) => {
  if (getGroupStrokeCount(group) !== 1) return null
  const stroke = getGroupStrokes(group)[0]
  if (!stroke || stroke.points.length < 3) return null
  const middlePoint = stroke.points[Math.floor(stroke.points.length / 2)]
  const firstPoint = stroke.points[0]
  const lastPoint = stroke.points[stroke.points.length - 1]
  if (!middlePoint || !firstPoint || !lastPoint) return null
  const valleyDepth = middlePoint.y - Math.max(firstPoint.y, lastPoint.y)
  if (valleyDepth < Math.max(10, group.bounds.height * 0.22)) return null
  if (!(firstPoint.x < middlePoint.x && middlePoint.x < lastPoint.x)) return null
  return makeSymbol('latin', 'v', 0.82, ['single-stroke valley shape with a clear lower middle point'])
}

const recognizeTwo = (group: StrokeGroup) => {
  if (getGroupStrokeCount(group) !== 1) return null
  const stroke = getGroupStrokes(group)[0]
  if (!stroke || stroke.points.length < 5) return null
  const firstPoint = stroke.points[0]
  const lastPoint = stroke.points[stroke.points.length - 1]
  if (!firstPoint || !lastPoint) return null
  if (lastPoint.x <= firstPoint.x + group.bounds.width * 0.2) return null
  if (lastPoint.y <= firstPoint.y + group.bounds.height * 0.35) return null
  if (lastPoint.y >= firstPoint.y + group.bounds.height * 0.75) return null
  return makeSymbol('digit', '2', 0.8, ['single-stroke upper sweep resolves into a lower-right tail'])
}

const recognizeThree = (group: StrokeGroup) => {
  if (getGroupStrokeCount(group) !== 1) return null
  const stroke = getGroupStrokes(group)[0]
  if (!stroke || stroke.points.length < 6) return null
  const firstPoint = stroke.points[0]
  const lastPoint = stroke.points[stroke.points.length - 1]
  if (!firstPoint || !lastPoint) return null
  if (Math.abs(lastPoint.x - firstPoint.x) > group.bounds.width * 0.38) return null
  return makeSymbol('digit', '3', 0.77, ['single-stroke double-lobe shape returns near its starting horizontal column'])
}

const recognizeZ = (group: StrokeGroup) => {
  if (getGroupStrokeCount(group) !== 2) return null
  const strokes = getGroupStrokes(group)
  const longStroke = strokes.find((stroke) => stroke.points.length >= 4)
  const diagonalStroke = strokes.find((stroke) => getStrokeSlopeKind(stroke) === 'negative')
  if (!longStroke || !diagonalStroke) return null
  return makeSymbol('latin', 'z', 0.78, ['top-and-bottom horizontal sweep reinforced by a descending diagonal stroke'])
}

const recognizePi = (group: StrokeGroup) => {
  if (getGroupStrokeCount(group) !== 3) return null
  const strokes = getGroupStrokes(group)
  const horizontalCount = strokes.filter(isHorizontalStroke).length
  const verticalCount = strokes.filter(isVerticalStroke).length
  if (horizontalCount < 1 || verticalCount < 2) return null
  return makeSymbol('greek', 'π', 0.86, ['horizontal cap with two vertical posts matches a pi prototype'])
}

const recognizeLambda = (group: StrokeGroup) => {
  if (getGroupStrokeCount(group) !== 1) return null
  const stroke = getGroupStrokes(group)[0]
  if (!stroke || stroke.points.length < 3) return null
  const peak = stroke.points.reduce((best, point) => point.y < best.y ? point : best, stroke.points[0])
  const firstPoint = stroke.points[0]
  const lastPoint = stroke.points[stroke.points.length - 1]
  if (!peak || !firstPoint || !lastPoint) return null
  if (peak === firstPoint || peak === lastPoint) return null
  if (!(firstPoint.y > peak.y + group.bounds.height * 0.18 && lastPoint.y > peak.y + group.bounds.height * 0.18)) return null
  return makeSymbol('greek', 'λ', 0.74, ['single-stroke peaked shape matches a lambda prototype'])
}

const recognizeRadical = (group: StrokeGroup) => {
  if (getGroupStrokeCount(group) !== 1) return null
  const stroke = getGroupStrokes(group)[0]
  if (!stroke || stroke.points.length < 4) return null
  const points = stroke.points
  const segmentDx = points.slice(1).map((point, index) => point.x - points[index].x)
  const segmentDy = points.slice(1).map((point, index) => point.y - points[index].y)
  const lowestIndex = points.reduce((bestIndex, point, index) => point.y > points[bestIndex].y ? index : bestIndex, 0)
  if (lowestIndex <= 0 || lowestIndex >= points.length - 2) return null
  const hasDip = segmentDy.slice(0, lowestIndex).some((dy) => dy > Math.max(8, group.bounds.height * 0.14))
  const hasRise = segmentDy.slice(lowestIndex).some((dy) => dy < -Math.max(16, group.bounds.height * 0.18))
  const tailSegments = segmentDx.slice(Math.max(lowestIndex, points.length - 3))
  const tailDySegments = segmentDy.slice(Math.max(lowestIndex, points.length - 3))
  const hasTail = tailSegments.some((dx, index) => dx > Math.max(18, group.bounds.width * 0.18) && Math.abs(tailDySegments[index] || 0) < Math.max(10, group.bounds.height * 0.08))
  const startsNearLeft = points[0].x <= group.bounds.left + group.bounds.width * 0.18
  const endsNearRight = points[points.length - 1].x >= group.bounds.right - group.bounds.width * 0.18
  const endsHigh = points[points.length - 1].y <= group.bounds.top + group.bounds.height * 0.28
  if (!hasDip || !hasRise || !hasTail || !startsNearLeft || !endsNearRight || !endsHigh) return null
  return makeSymbol('operator', '√', 0.79, ['check-like dip, steep rise, and rightward tail match a radical prototype'])
}

const recognizeMinus = (group: StrokeGroup) => {
  if (getGroupStrokeCount(group) !== 1) return null
  if (!isHorizontalStroke(getGroupStrokes(group)[0])) return null
  if (group.bounds.width < Math.max(24, group.bounds.height * 2.4)) return null
  return makeSymbol('operator', '-', 0.84, ['single horizontal stroke outside a fraction-structure role'])
}

export const recognizeSymbolForRole = (group: StrokeGroup, role: StructuralRole): RecognizedSymbol => {
  const structural = recognizeStructuralSymbol(role)
  if (structural) return structural

  const heuristics = [
    recognizePlus,
    recognizeX,
    recognizeFour,
    recognizePi,
    recognizeTwo,
    recognizeThree,
    recognizeRadical,
    recognizeLambda,
    recognizeZ,
    recognizeV,
    recognizeMinus,
  ]

  for (const heuristic of heuristics) {
    const recognized = heuristic(group)
    if (recognized) return recognized
  }

  return makeSymbol('unknown', 'unknown', 0.18, ['no seeded symbol heuristic matched this stroke group'])
}

export const formatQualifiedRoleLabel = (role: StructuralRole, symbol: RecognizedSymbol | null | undefined) => `${role.role}-${symbol?.value || 'unknown'}`

export const annotateRolesWithRecognizedSymbols = (roles: StructuralRole[], groups: StrokeGroup[]) => {
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  return roles.map((role) => {
    const group = groupMap.get(role.groupId)
    if (!group) {
      return {
        ...role,
        recognizedSymbol: makeSymbol('unknown', 'unknown', 0.12, ['stroke group not found during symbol annotation']),
        qualifiedRoleLabel: `${role.role}-unknown`,
      }
    }
    const recognizedSymbol = recognizeSymbolForRole(group, role)
    const qualifiedRoleLabel = formatQualifiedRoleLabel(role, recognizedSymbol)
    return {
      ...role,
      recognizedSymbol,
      qualifiedRoleLabel,
      evidence: [...role.evidence, `symbol=${recognizedSymbol.value}`, `symbol-category=${recognizedSymbol.category}`, `qualified-role=${qualifiedRoleLabel}`],
    }
  })
}