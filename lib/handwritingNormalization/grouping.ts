import { getStrokeBounds, getStrokeCentroid, mergeBounds, strokesVisiblyOverlap } from './geometry'
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

const scorePairCompatibility = (left: InkStroke, right: InkStroke) => {
  if (!strokesVisiblyOverlap(left, right)) return 0

  const temporalGap = Math.min(Math.abs(getStrokeStart(left, 0) - getStrokeEnd(right, 0)), Math.abs(getStrokeEnd(left, 0) - getStrokeStart(right, 0)))
  const temporalScore = Math.max(0, 1 - temporalGap / 1100)
  return Math.max(0.94, 0.94 + temporalScore * 0.06)
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

  return groups.sort((left, right) => {
    if (Math.abs(left.bounds.left - right.bounds.left) > 10) return left.bounds.left - right.bounds.left
    return left.bounds.top - right.bounds.top
  })
}