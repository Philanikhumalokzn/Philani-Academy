import { clamp, getBoundsOverlapX, getBoundsOverlapY, getHorizontalGap, getVerticalGap, isInsideBounds } from './geometry'
import type { LayoutEdge, LegoBrickHypothesis, StrokeGroup } from './types'

const getFieldWeight = (
  topBrickHypothesisByGroupId: Map<string, LegoBrickHypothesis>,
  groupId: string,
  fieldKind: 'leftInline' | 'rightInline',
) => {
  const topHypothesis = topBrickHypothesisByGroupId.get(groupId)
  if (!topHypothesis) return null
  return topHypothesis.fields.find((field) => field.kind === fieldKind)?.weight ?? 0
}

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

export const buildLayoutGraph = (groups: StrokeGroup[], brickHypotheses: LegoBrickHypothesis[] = []) => {
  const edges: LayoutEdge[] = []
  const topBrickHypothesisByGroupId = new Map<string, LegoBrickHypothesis>()

  for (const hypothesis of brickHypotheses) {
    const current = topBrickHypothesisByGroupId.get(hypothesis.groupId)
    if (!current || current.score < hypothesis.score) {
      topBrickHypothesisByGroupId.set(hypothesis.groupId, hypothesis)
    }
  }

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
      const widthRatio = Math.max(0.2, Math.min(4.2, Math.max(to.bounds.width, 1) / Math.max(from.bounds.width, 1)))
      const smallerRightGroupBias = to.bounds.height <= from.bounds.height * 1.05 ? 1 : 0.72
      const rightwardScore = dx > 0 ? clamp(1 - horizontalGap / (scale * 1.75), 0, 1) : 0
      const verticalAlignmentScore = clamp(1 - Math.abs(dy) / Math.max(24, scale * 0.72), 0, 1)
      const centeredXScore = clamp(1 - Math.abs(dx) / Math.max(20, from.bounds.width * 0.42), 0, 1)
      const belowRightScore = dx > 0 && dy > 0
        ? clamp(1 - Math.abs(dx - Math.max(14, from.bounds.width * 0.48)) / Math.max(22, from.bounds.width * 0.9), 0, 1)
        : 0
      const directlyBelowScore = dy > 0
        ? centeredXScore * clamp(1 - verticalGap / Math.max(18, from.bounds.height * 1.2), 0, 1)
        : 0
      const spanSimilarity = clamp(1 - Math.abs(widthRatio - 1) / 0.82, 0, 1)
      const horizontalSequenceAffinity = clamp(1 - Math.abs(dy) / Math.max(34, scale * 1.15), 0, 1)
      const fromRightInlineWeight = getFieldWeight(topBrickHypothesisByGroupId, from.id, 'rightInline')
      const toLeftInlineWeight = getFieldWeight(topBrickHypothesisByGroupId, to.id, 'leftInline')
      const inlineAffordanceScore = fromRightInlineWeight === null || toLeftInlineWeight === null
        ? 1
        : clamp(Math.sqrt(Math.max(fromRightInlineWeight, 0) * Math.max(toLeftInlineWeight, 0)), 0, 1)
      const inlineAffordanceMultiplier = fromRightInlineWeight === null || toLeftInlineWeight === null
        ? 1
        : 0.32 + inlineAffordanceScore * 0.68
      const sequenceScore = (rightwardScore * 0.42 + horizontalSequenceAffinity * 0.18 + overlapY * 0.1) * 0.46 * (dy < -from.bounds.height * 0.18 ? 0.72 : 1) * smallerRightGroupBias * inlineAffordanceMultiplier

      pushEdge(edges, from.id, to.id, 'sequence', sequenceScore, {
        dx,
        dy,
        horizontalGap,
        verticalGap,
        overlapX,
        overlapY,
        sizeRatio,
        widthRatio,
        centeredXScore,
        belowRightScore,
        directlyBelowScore,
        spanSimilarity,
        fromRightInlineWeight: fromRightInlineWeight ?? -1,
        toLeftInlineWeight: toLeftInlineWeight ?? -1,
        inlineAffordanceScore,
      })

      const superscriptZoneScore = dy < 0
        ? clamp(1 - Math.abs(dy + Math.max(from.bounds.height * 1.15, to.bounds.height * 1.35)) / Math.max(36, from.bounds.height * 1.5), 0, 1)
        : 0
      const superscriptSizeScore = clamp(1 - Math.abs(sizeRatio - 0.9) / 1.1, 0, 1)
      const superscriptSpatialCloseness = dx > 0
        ? clamp(1 - horizontalGap / Math.max(18, scale * 1.18), 0, 1)
        : 0
      const superScore = dx > 0
        ? superscriptZoneScore * 0.6 + superscriptSpatialCloseness * 0.26 + superscriptSizeScore * 0.14
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
      const subscriptSpatialCloseness = dx > 0
        ? clamp(1 - horizontalGap / Math.max(18, scale * 1.18), 0, 1)
        : 0
      const directBelowPenalty = directlyBelowScore * clamp(spanSimilarity * 0.9 + Math.max(widthRatio - 1, 0) * 0.15, 0, 1)
      const subScore = dx > 0
        ? Math.max(0, subscriptZoneScore * 0.44 + subscriptSpatialCloseness * 0.18 + subscriptSizeScore * 0.12 + belowRightScore * 0.26 - directBelowPenalty * 0.24)
        : 0
      pushEdge(edges, from.id, to.id, 'subscriptCandidate', subScore, {
        dx,
        dy,
        horizontalGap,
        overlapX,
        sizeRatio,
        widthRatio,
        centeredXScore,
        belowRightScore,
        directlyBelowScore,
        spanSimilarity,
      })

      const stackedAboveScore = dy < 0
        ? (clamp(1 - Math.abs(dx) / Math.max(24, from.bounds.width * 0.75), 0, 1) * 0.58 + clamp(1 - verticalGap / Math.max(30, from.bounds.height * 1.2), 0, 1) * 0.42)
        : 0
      pushEdge(edges, from.id, to.id, 'stackedAbove', stackedAboveScore, {
        dx,
        dy,
        verticalGap,
        overlapX,
      })

      const stackedBelowScore = dy > 0
        ? (clamp(1 - Math.abs(dx) / Math.max(24, from.bounds.width * 0.75), 0, 1) * 0.58 + clamp(1 - verticalGap / Math.max(30, from.bounds.height * 1.2), 0, 1) * 0.42)
        : 0
      pushEdge(edges, from.id, to.id, 'stackedBelow', stackedBelowScore, {
        dx,
        dy,
        verticalGap,
        overlapX,
        centeredXScore,
        directlyBelowScore,
        spanSimilarity,
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