import { clamp, getBoundsOverlapX, getBoundsOverlapY, getHorizontalGap, getVerticalGap, isInsideBounds } from './geometry'
import type { LayoutEdge, StrokeGroup } from './types'

const pushEdge = (
  edges: LayoutEdge[],
  fromId: string,
  toId: string,
  kind: LayoutEdge['kind'],
  score: number,
  metrics: Record<string, number>
) => {
  if (score <= 0) return
  edges.push({ id: `${fromId}:${kind}:${toId}`, fromId, toId, kind, score: clamp(score, 0, 1), metrics })
}

export const buildLayoutGraph = (groups: StrokeGroup[]) => {
  const edges: LayoutEdge[] = []

  for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < groups.length; rightIndex += 1) {
      if (leftIndex === rightIndex) continue

      const from = groups[leftIndex]
      const to = groups[rightIndex]
      const dx = to.bounds.centerX - from.bounds.centerX
      const dy = to.bounds.centerY - from.bounds.centerY
      const horizontalGap = getHorizontalGap(from.bounds, to.bounds)
      const verticalGap = getVerticalGap(from.bounds, to.bounds)
      const overlapX = getBoundsOverlapX(from.bounds, to.bounds)
      const overlapY = getBoundsOverlapY(from.bounds, to.bounds)
      const scale = Math.max(18, Math.max(from.bounds.width, from.bounds.height))
      const sizeRatio = Math.max(0.35, Math.min(1.85, Math.max(to.bounds.height, 1) / Math.max(from.bounds.height, 1)))
      const smallerRightGroupBias = to.bounds.height <= from.bounds.height * 1.05 ? 1 : 0.72
      const rightwardScore = dx > 0 ? clamp(1 - horizontalGap / (scale * 1.75), 0, 1) : 0
      const verticalAlignmentScore = clamp(1 - Math.abs(dy) / Math.max(24, scale * 0.58), 0, 1)
      const sequenceScore = (rightwardScore * 0.68 + verticalAlignmentScore * 0.32) * (dy < -from.bounds.height * 0.22 ? 0.86 : 1) * smallerRightGroupBias

      pushEdge(edges, from.id, to.id, 'sequence', sequenceScore, {
        dx,
        dy,
        horizontalGap,
        verticalGap,
        overlapX,
        overlapY,
        sizeRatio,
      })

      const superscriptZoneScore = dy < 0
        ? clamp(1 - Math.abs(dy + Math.max(from.bounds.height * 1.15, to.bounds.height * 1.35)) / Math.max(36, from.bounds.height * 1.5), 0, 1)
        : 0
      const superscriptSizeScore = clamp(1 - Math.abs(sizeRatio - 0.9) / 1.1, 0, 1)
      const superScore = dx > 0
        ? superscriptZoneScore * 0.64 + clamp(1 - horizontalGap / Math.max(22, scale * 1.35), 0, 1) * 0.2 + superscriptSizeScore * 0.16
        : 0
      pushEdge(edges, from.id, to.id, 'superscriptCandidate', superScore, {
        dx,
        dy,
        horizontalGap,
        overlapX,
        sizeRatio,
      })

      const subscriptZoneScore = dy > 0
        ? clamp(1 - Math.abs(dy - Math.max(from.bounds.height * 0.78, to.bounds.height * 0.9)) / Math.max(34, from.bounds.height * 1.4), 0, 1)
        : 0
      const subscriptSizeScore = clamp(1 - Math.abs(sizeRatio - 0.9) / 1.1, 0, 1)
      const subScore = dx > 0
        ? subscriptZoneScore * 0.64 + clamp(1 - horizontalGap / Math.max(22, scale * 1.35), 0, 1) * 0.2 + subscriptSizeScore * 0.16
        : 0
      pushEdge(edges, from.id, to.id, 'subscriptCandidate', subScore, {
        dx,
        dy,
        horizontalGap,
        overlapX,
        sizeRatio,
      })

      const stackedAboveScore = dy < 0
        ? clamp(1 - Math.abs(dx) / Math.max(24, from.bounds.width * 0.75), 0, 1) * clamp(1 - verticalGap / Math.max(30, from.bounds.height * 1.2), 0, 1)
        : 0
      pushEdge(edges, from.id, to.id, 'stackedAbove', stackedAboveScore, {
        dx,
        dy,
        verticalGap,
        overlapX,
      })

      const stackedBelowScore = dy > 0
        ? clamp(1 - Math.abs(dx) / Math.max(24, from.bounds.width * 0.75), 0, 1) * clamp(1 - verticalGap / Math.max(30, from.bounds.height * 1.2), 0, 1)
        : 0
      pushEdge(edges, from.id, to.id, 'stackedBelow', stackedBelowScore, {
        dx,
        dy,
        verticalGap,
        overlapX,
      })

      const insideScore = isInsideBounds(to.bounds, from.bounds)
        ? 0.8 + clamp((overlapX + overlapY) / 4, 0, 0.2)
        : 0
      pushEdge(edges, from.id, to.id, 'inside', insideScore, {
        dx,
        dy,
        overlapX,
        overlapY,
      })

      const overlapScore = clamp((overlapX + overlapY) / 2, 0, 1)
      pushEdge(edges, from.id, to.id, 'overlap', overlapScore, {
        dx,
        dy,
        overlapX,
        overlapY,
      })
    }
  }

  return edges.filter((edge) => edge.score >= 0.24).sort((left, right) => right.score - left.score)
}