import { clamp, distance, getStrokeBounds, getStrokeCentroid, mergeBounds, minStrokeDistance, strokesVisiblyOverlap } from './geometry'
import type { InkStroke, StrokeGroup } from './types'

const getStrokeStart = (stroke: InkStroke, fallback: number) => {
  if (typeof stroke.startedAt === 'number') return stroke.startedAt
  if (typeof stroke.points[0]?.t === 'number') return stroke.points[0].t as number
  return fallback
}

const getStrokeEnd = (stroke: InkStroke, fallback: number) => {
  if (typeof stroke.endedAt === 'number') return stroke.endedAt
  const lastPoint = stroke.points[stroke.points.length - 1]
  if (typeof lastPoint?.t === 'number') return lastPoint.t as number
  return fallback
}

const buildGroup = (id: string, strokes: InkStroke[]): StrokeGroup => {
  const strokeBounds = strokes.map(getStrokeBounds)
  const bounds = mergeBounds(strokeBounds)
  const centroid = strokes.reduce(
    (acc, stroke) => {
      const center = getStrokeCentroid(stroke)
      acc.x += center.x
      acc.y += center.y
      return acc
    },
    { x: 0, y: 0 }
  )

  centroid.x /= Math.max(1, strokes.length)
  centroid.y /= Math.max(1, strokes.length)

  const baselineY = bounds.bottom
  const aspectRatio = bounds.width / Math.max(bounds.height, 1)
  const flatness = bounds.height / Math.max(bounds.width, 1)
  const area = Math.max(1, bounds.width * bounds.height)
  const strokeDensity = strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) / area

  return {
    id,
    strokeIds: strokes.map((stroke) => stroke.id),
    strokes,
    bounds,
    centroid,
    baselineY,
    aspectRatio,
    flatness,
    density: strokeDensity,
    strokeCount: strokes.length,
    startedAt: Math.min(...strokes.map((stroke, index) => getStrokeStart(stroke, index * 12))),
    endedAt: Math.max(...strokes.map((stroke, index) => getStrokeEnd(stroke, index * 12 + 12))),
  }
}

const getStrokeOrientation = (stroke: InkStroke) => {
  const first = stroke.points[0]
  const last = stroke.points[stroke.points.length - 1]
  if (!first || !last) return { horizontal: 0, vertical: 0, diagonal: 0 }
  const dx = Math.abs(last.x - first.x)
  const dy = Math.abs(last.y - first.y)
  const total = Math.max(1, dx + dy)
  const horizontal = dx / total
  const vertical = dy / total
  const diagonal = 1 - Math.abs(horizontal - vertical)
  return { horizontal, vertical, diagonal }
}

const scorePairCompatibility = (left: InkStroke, right: InkStroke) => {
  const leftBounds = getStrokeBounds(left)
  const rightBounds = getStrokeBounds(right)
  const leftCenter = getStrokeCentroid(left)
  const rightCenter = getStrokeCentroid(right)
  const centerDistance = distance(leftCenter, rightCenter)
  const scale = Math.max(20, Math.max(leftBounds.width, leftBounds.height, rightBounds.width, rightBounds.height))
  const proximityScore = clamp(1 - centerDistance / (scale * 1.55), 0, 1)
  const overlapX = Math.max(0, Math.min(leftBounds.right, rightBounds.right) - Math.max(leftBounds.left, rightBounds.left))
  const overlapY = Math.max(0, Math.min(leftBounds.bottom, rightBounds.bottom) - Math.max(leftBounds.top, rightBounds.top))
  const overlapScore = clamp((overlapX + overlapY) / Math.max(scale, 1), 0, 1)
  const temporalGap = Math.min(Math.abs(getStrokeStart(left, 0) - getStrokeEnd(right, 0)), Math.abs(getStrokeEnd(left, 0) - getStrokeStart(right, 0)))
  const temporalScore = clamp(1 - temporalGap / 1100, 0, 1)
  const leftOrientation = getStrokeOrientation(left)
  const rightOrientation = getStrokeOrientation(right)
  const crossingBias = leftOrientation.diagonal * rightOrientation.diagonal
  const plusBias = Math.max(leftOrientation.horizontal * rightOrientation.vertical, leftOrientation.vertical * rightOrientation.horizontal)
  const lineBias = Math.max(crossingBias, plusBias)
  const explicitOverlap = strokesVisiblyOverlap(left, right)
  const minDistance = minStrokeDistance(left, right)
  const distanceBias = clamp(1 - minDistance / Math.max(6, scale * 0.18), 0, 1)

  if (explicitOverlap) {
    return Math.max(0.94, proximityScore * 0.28 + temporalScore * 0.08 + lineBias * 0.18 + distanceBias * 0.46)
  }

  return proximityScore * 0.33 + overlapScore * 0.12 + temporalScore * 0.12 + lineBias * 0.18 + distanceBias * 0.25
}

const scoreStrokeToGroup = (stroke: InkStroke, group: StrokeGroup) => {
  const strokeBounds = getStrokeBounds(stroke)
  const strokeCenter = getStrokeCentroid(stroke)
  const groupCenter = group.centroid
  const centerDistance = distance(strokeCenter, groupCenter)
  const scale = Math.max(28, Math.max(group.bounds.width, group.bounds.height, strokeBounds.width, strokeBounds.height))
  const distanceScore = clamp(1 - centerDistance / (scale * 1.6), 0, 1)
  const temporalGap = Math.min(Math.abs(getStrokeStart(stroke, 0) - group.endedAt), Math.abs(getStrokeEnd(stroke, 0) - group.startedAt))
  const temporalScore = clamp(1 - temporalGap / 850, 0, 1)
  const overlapX = Math.max(0, Math.min(strokeBounds.right, group.bounds.right) - Math.max(strokeBounds.left, group.bounds.left))
  const overlapY = Math.max(0, Math.min(strokeBounds.bottom, group.bounds.bottom) - Math.max(strokeBounds.top, group.bounds.top))
  const overlapScore = clamp((overlapX + overlapY) / Math.max(1, scale), 0, 1)
  const pairCompatibility = group.strokes.reduce((sum, candidate) => sum + scorePairCompatibility(stroke, candidate), 0) / Math.max(1, group.strokes.length)
  const overlapDominance = group.strokes.some((candidate) => strokesVisiblyOverlap(stroke, candidate))

  if (overlapDominance) {
    return Math.max(0.94, pairCompatibility)
  }

  return distanceScore * 0.24 + temporalScore * 0.1 + overlapScore * 0.1 + pairCompatibility * 0.56
}

const mergeConnectedSeeds = (strokes: InkStroke[]) => {
  const groups: InkStroke[][] = []
  const used = new Set<string>()

  for (const stroke of strokes) {
    if (used.has(stroke.id)) continue
    const bucket = [stroke]
    used.add(stroke.id)

    let expanded = true
    while (expanded) {
      expanded = false
      for (const candidate of strokes) {
        if (used.has(candidate.id)) continue
        const compatible = bucket.some((member) => scorePairCompatibility(member, candidate) >= 0.74)
        if (!compatible) continue
        bucket.push(candidate)
        used.add(candidate.id)
        expanded = true
      }
    }

    groups.push(bucket)
  }

  return groups
}

export const groupInkStrokes = (strokes: InkStroke[]) => {
  const ordered = [...strokes].sort((left, right) => getStrokeStart(left, 0) - getStrokeStart(right, 0))
  const groups: StrokeGroup[] = mergeConnectedSeeds(ordered).map((bucket, index) => buildGroup(`group-${index + 1}`, bucket))

  for (const stroke of ordered) {
    if (!stroke.points.length) continue
    if (groups.some((group) => group.strokeIds.includes(stroke.id))) continue
    let bestIndex = -1
    let bestScore = 0

    for (let index = 0; index < groups.length; index += 1) {
      const score = scoreStrokeToGroup(stroke, groups[index])
      if (score > bestScore) {
        bestScore = score
        bestIndex = index
      }
    }

    if (bestIndex >= 0 && bestScore >= 0.67) {
      const existing = groups[bestIndex]
      groups[bestIndex] = buildGroup(existing.id, [...existing.strokes, stroke])
      continue
    }

    groups.push(buildGroup(`group-${groups.length + 1}`, [stroke]))
  }

  return groups.sort((left, right) => {
    if (Math.abs(left.bounds.left - right.bounds.left) > 10) return left.bounds.left - right.bounds.left
    return left.bounds.top - right.bounds.top
  })
}