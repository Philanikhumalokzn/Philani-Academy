import type { InkBounds, InkPoint, InkStroke } from './types'

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const distance = (left: InkPoint, right: InkPoint) => {
  const dx = left.x - right.x
  const dy = left.y - right.y
  return Math.sqrt(dx * dx + dy * dy)
}

const dot = (ax: number, ay: number, bx: number, by: number) => ax * bx + ay * by

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx

const segmentVector = (from: InkPoint, to: InkPoint) => ({ x: to.x - from.x, y: to.y - from.y })

export const distancePointToSegment = (point: InkPoint, start: InkPoint, end: InkPoint) => {
  const segment = segmentVector(start, end)
  const lengthSq = dot(segment.x, segment.y, segment.x, segment.y)
  if (lengthSq <= 0.0001) return distance(point, start)
  const projection = dot(point.x - start.x, point.y - start.y, segment.x, segment.y) / lengthSq
  const t = clamp(projection, 0, 1)
  const projected = { x: start.x + segment.x * t, y: start.y + segment.y * t }
  return distance(point, projected)
}

const orientation = (a: InkPoint, b: InkPoint, c: InkPoint) => {
  const value = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y)
  if (Math.abs(value) < 0.001) return 0
  return value > 0 ? 1 : -1
}

const onSegment = (a: InkPoint, b: InkPoint, c: InkPoint) => {
  return c.x >= Math.min(a.x, b.x) - 0.001 && c.x <= Math.max(a.x, b.x) + 0.001 && c.y >= Math.min(a.y, b.y) - 0.001 && c.y <= Math.max(a.y, b.y) + 0.001
}

export const segmentsIntersect = (a1: InkPoint, a2: InkPoint, b1: InkPoint, b2: InkPoint) => {
  const o1 = orientation(a1, a2, b1)
  const o2 = orientation(a1, a2, b2)
  const o3 = orientation(b1, b2, a1)
  const o4 = orientation(b1, b2, a2)

  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSegment(a1, a2, b1)) return true
  if (o2 === 0 && onSegment(a1, a2, b2)) return true
  if (o3 === 0 && onSegment(b1, b2, a1)) return true
  if (o4 === 0 && onSegment(b1, b2, a2)) return true
  return false
}

const getStrokeSegments = (stroke: InkStroke) => {
  const segments: Array<[InkPoint, InkPoint]> = []
  for (let index = 1; index < stroke.points.length; index += 1) {
    segments.push([stroke.points[index - 1], stroke.points[index]])
  }
  return segments
}

export const minStrokeDistance = (left: InkStroke, right: InkStroke) => {
  const leftSegments = getStrokeSegments(left)
  const rightSegments = getStrokeSegments(right)
  if (!leftSegments.length || !rightSegments.length) {
    if (!left.points.length || !right.points.length) return Number.POSITIVE_INFINITY
    return Math.min(
      ...left.points.map((point) => Math.min(...right.points.map((other) => distance(point, other)))),
      ...right.points.map((point) => Math.min(...left.points.map((other) => distance(point, other))))
    )
  }

  let best = Number.POSITIVE_INFINITY
  for (const [leftStart, leftEnd] of leftSegments) {
    for (const [rightStart, rightEnd] of rightSegments) {
      if (segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd)) return 0
      best = Math.min(
        best,
        distancePointToSegment(leftStart, rightStart, rightEnd),
        distancePointToSegment(leftEnd, rightStart, rightEnd),
        distancePointToSegment(rightStart, leftStart, leftEnd),
        distancePointToSegment(rightEnd, leftStart, leftEnd)
      )
    }
  }
  return best
}

export const strokesVisiblyOverlap = (left: InkStroke, right: InkStroke) => {
  return minStrokeDistance(left, right) <= 0.001
}

export const getStrokeBounds = (stroke: InkStroke): InkBounds => {
  const points = stroke.points || []
  if (!points.length) {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, centerX: 0, centerY: 0 }
  }

  let left = points[0].x
  let right = points[0].x
  let top = points[0].y
  let bottom = points[0].y

  for (const point of points) {
    if (point.x < left) left = point.x
    if (point.x > right) right = point.x
    if (point.y < top) top = point.y
    if (point.y > bottom) bottom = point.y
  }

  const width = right - left
  const height = bottom - top

  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  }
}

export const mergeBounds = (boundsList: InkBounds[]): InkBounds => {
  if (!boundsList.length) {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, centerX: 0, centerY: 0 }
  }

  let left = boundsList[0].left
  let right = boundsList[0].right
  let top = boundsList[0].top
  let bottom = boundsList[0].bottom

  for (const bounds of boundsList) {
    if (bounds.left < left) left = bounds.left
    if (bounds.right > right) right = bounds.right
    if (bounds.top < top) top = bounds.top
    if (bounds.bottom > bottom) bottom = bounds.bottom
  }

  const width = right - left
  const height = bottom - top

  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  }
}

export const getStrokeCentroid = (stroke: InkStroke) => {
  if (!stroke.points.length) return { x: 0, y: 0 }
  let sumX = 0
  let sumY = 0
  for (const point of stroke.points) {
    sumX += point.x
    sumY += point.y
  }
  return { x: sumX / stroke.points.length, y: sumY / stroke.points.length }
}

export const getBoundsOverlapX = (left: InkBounds, right: InkBounds) => {
  const overlap = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
  const basis = Math.max(1, Math.min(left.width || 1, right.width || 1))
  return overlap / basis
}

export const getBoundsOverlapY = (topBounds: InkBounds, bottomBounds: InkBounds) => {
  const overlap = Math.max(0, Math.min(topBounds.bottom, bottomBounds.bottom) - Math.max(topBounds.top, bottomBounds.top))
  const basis = Math.max(1, Math.min(topBounds.height || 1, bottomBounds.height || 1))
  return overlap / basis
}

export const getHorizontalGap = (left: InkBounds, right: InkBounds) => {
  if (right.left >= left.right) return right.left - left.right
  if (left.left >= right.right) return left.left - right.right
  return 0
}

export const getVerticalGap = (topBounds: InkBounds, bottomBounds: InkBounds) => {
  if (bottomBounds.top >= topBounds.bottom) return bottomBounds.top - topBounds.bottom
  if (topBounds.top >= bottomBounds.bottom) return topBounds.top - bottomBounds.bottom
  return 0
}

export const isInsideBounds = (inner: InkBounds, outer: InkBounds) => {
  return inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom
}

export const scalePointAround = (point: InkPoint, anchor: InkPoint, scale: number): InkPoint => ({
  ...point,
  x: anchor.x + (point.x - anchor.x) * scale,
  y: anchor.y + (point.y - anchor.y) * scale,
})

export const translatePoint = (point: InkPoint, dx: number, dy: number): InkPoint => ({
  ...point,
  x: point.x + dx,
  y: point.y + dy,
})

export const transformStroke = (stroke: InkStroke, scale: number, anchor: InkPoint, dx: number, dy: number): InkStroke => ({
  ...stroke,
  points: stroke.points.map((point) => translatePoint(scalePointAround(point, anchor, scale), dx, dy)),
})

export const scoreFromDistance = (value: number, ideal: number, tolerance: number) => {
  if (tolerance <= 0) return value === ideal ? 1 : 0
  const delta = Math.abs(value - ideal)
  return clamp(1 - delta / tolerance, 0, 1)
}