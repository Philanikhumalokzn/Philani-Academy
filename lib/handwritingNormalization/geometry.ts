import type { InkBounds, InkPoint, InkStroke } from './types'

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const distance = (left: InkPoint, right: InkPoint) => {
  const dx = left.x - right.x
  const dy = left.y - right.y
  return Math.sqrt(dx * dx + dy * dy)
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