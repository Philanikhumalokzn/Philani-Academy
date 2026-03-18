import { getStrokeBounds, mergeBounds, transformStroke } from './geometry'
import type { ExpressionContext, InkStroke, NormalizationResult, StrokeGroup, StructuralRole } from './types'

const getRoleScale = (role: StructuralRole, inFractionMemberContext: boolean) => {
  if (role.role === 'superscript' || role.role === 'subscript') {
    const baseScale = Math.max(0.42, 0.68 - role.depth * 0.1)
    return inFractionMemberContext ? Math.max(0.34, baseScale * 0.82) : baseScale
  }
  if (inFractionMemberContext) return 0.82
  return 1
}

const isBaselineLikeRole = (roleName: StructuralRole['role']) => {
  return roleName === 'baseline' || roleName === 'enclosureOpen' || roleName === 'enclosureClose'
}

const getScriptAnchorBounds = (
  role: StructuralRole,
  groupMap: Map<string, StrokeGroup>,
  transformedBounds: Map<string, ReturnType<typeof mergeBounds>>,
) => {
  const anchorBounds = role.normalizationAnchorGroupIds
    .map((groupId) => transformedBounds.get(groupId) || groupMap.get(groupId)?.bounds)
    .filter(Boolean) as Array<ReturnType<typeof mergeBounds>>
  if (anchorBounds.length) return mergeBounds(anchorBounds)
  if (!role.parentGroupId) return null
  return transformedBounds.get(role.parentGroupId) || groupMap.get(role.parentGroupId)?.bounds || null
}

const getTranslatedBounds = (bounds: ReturnType<typeof mergeBounds>, dx: number, dy: number) => ({
  ...bounds,
  left: bounds.left + dx,
  right: bounds.right + dx,
  top: bounds.top + dy,
  bottom: bounds.bottom + dy,
  centerX: bounds.centerX + dx,
  centerY: bounds.centerY + dy,
})

const getScaledAndTranslatedBounds = (
  bounds: ReturnType<typeof mergeBounds>,
  centerX: number,
  centerY: number,
  scale: number,
  dx: number,
  dy: number,
) => ({
  left: (bounds.left - centerX) * scale + centerX + dx,
  right: (bounds.right - centerX) * scale + centerX + dx,
  top: (bounds.top - centerY) * scale + centerY + dy,
  bottom: (bounds.bottom - centerY) * scale + centerY + dy,
  width: bounds.width * scale,
  height: bounds.height * scale,
  centerX: (bounds.centerX - centerX) * scale + centerX + dx,
  centerY: (bounds.centerY - centerY) * scale + centerY + dy,
})

export const normalizeInkLayout = (groups: StrokeGroup[], roles: StructuralRole[], contexts: ExpressionContext[] = []): NormalizationResult => {
  const roleMap = new Map(roles.map((role) => [role.groupId, role]))
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const contextMap = new Map(contexts.map((context) => [context.id, context]))
  const transformedStrokes: InkStroke[] = []
  const transformedGroups: NormalizationResult['groups'] = []
  const transformedBounds = new Map<string, ReturnType<typeof mergeBounds>>()
  const scalesByGroupId = new Map<string, number>()
  const scaledStrokesByGroupId = new Map<string, InkStroke[]>()
  const scaledBoundsByGroupId = new Map<string, ReturnType<typeof mergeBounds>>()
  const localTranslationsByGroupId = new Map<string, { dx: number, dy: number }>()
  const contextTranslationsByContextId = new Map<string, { dx: number, dy: number }>()
  const enclosureTransformsByContextId = new Map<string, { scale: number, centerX: number, centerY: number, dx: number, dy: number, memberGroupIds: string[] }>()

  const fractionMemberContexts = contexts.filter((context) => context.kind === 'numerator' || context.kind === 'denominator')
  const enclosureContexts = contexts.filter((context) => context.kind === 'enclosure')
  const fractionMemberContextIdByGroupId = new Map<string, string>()
  for (const context of [...fractionMemberContexts].sort((left, right) => left.memberGroupIds.length - right.memberGroupIds.length)) {
    for (const groupId of context.memberGroupIds) {
      if (!fractionMemberContextIdByGroupId.has(groupId)) {
        fractionMemberContextIdByGroupId.set(groupId, context.id)
      }
    }
  }

  const baselineGroups = groups.filter((group) => {
    if (!isBaselineLikeRole(roleMap.get(group.id)?.role || 'baseline')) return false
    return !fractionMemberContextIdByGroupId.has(group.id)
  })
  const baselineHeight = baselineGroups.length
    ? baselineGroups.reduce((sum, group) => sum + Math.max(group.bounds.height, 24), 0) / baselineGroups.length
    : 44
  const baselineY = baselineGroups.length
    ? baselineGroups.reduce((sum, group) => sum + group.bounds.bottom, 0) / baselineGroups.length
    : 240

  const ordered = [...groups].sort((left, right) => {
    const leftDepth = roleMap.get(left.id)?.depth || 0
    const rightDepth = roleMap.get(right.id)?.depth || 0
    if (leftDepth !== rightDepth) return leftDepth - rightDepth
    return left.bounds.left - right.bounds.left
  })

  for (const group of ordered) {
    const role = roleMap.get(group.id)
    if (!role) continue
    const fractionMemberContextId = fractionMemberContextIdByGroupId.get(group.id) || null
    const inFractionMemberContext = Boolean(fractionMemberContextId)
    const scale = getRoleScale(role, inFractionMemberContext)
    scalesByGroupId.set(group.id, scale)
    const anchor = { x: group.bounds.centerX, y: group.bounds.centerY }
    const scaledStrokes = group.strokes.map((stroke) => transformStroke(stroke, scale, anchor, 0, 0))
    const scaledBounds = mergeBounds(scaledStrokes.map(getStrokeBounds))
    scaledStrokesByGroupId.set(group.id, scaledStrokes)
    scaledBoundsByGroupId.set(group.id, scaledBounds)
    let dx = 0
    let dy = 0

    if (isBaselineLikeRole(role.role) && !inFractionMemberContext) {
      dy = baselineY - scaledBounds.bottom
      const targetHeight = baselineHeight
      const heightAdjust = targetHeight - scaledBounds.height
      dy -= heightAdjust * 0.18
    }

    if ((role.role === 'superscript' || role.role === 'subscript') && role.parentGroupId && !inFractionMemberContext) {
      const parentBounds = getScriptAnchorBounds(role, groupMap, transformedBounds)
      if (parentBounds) {
        dx = parentBounds.right + Math.max(8, parentBounds.width * 0.05) - scaledBounds.left
        dy = role.role === 'superscript'
          ? parentBounds.top + parentBounds.height * 0.12 - scaledBounds.bottom
          : parentBounds.bottom - parentBounds.height * 0.1 - scaledBounds.top
      }
    }

    if (role.role === 'fractionBar' || role.role === 'provisionalFractionBar') {
      dy = baselineY - scaledBounds.centerY
    }

    localTranslationsByGroupId.set(group.id, { dx, dy })

    const locallyTranslatedBounds = mergeBounds(scaledStrokes.map(getStrokeBounds).map((bounds) => getTranslatedBounds(bounds, dx, dy)))

    transformedBounds.set(group.id, locallyTranslatedBounds)
  }

  for (const context of fractionMemberContexts) {
    const fractionContext = context.parentContextId ? contextMap.get(context.parentContextId) || null : null
    const fractionBarGroupId = fractionContext?.kind === 'fraction' ? fractionContext.semanticRootGroupId || null : null
    if (!fractionBarGroupId) continue
    const parentBounds = transformedBounds.get(fractionBarGroupId) || groupMap.get(fractionBarGroupId)?.bounds
    if (!parentBounds) continue

    const memberBounds = context.memberGroupIds
      .map((groupId) => transformedBounds.get(groupId))
      .filter(Boolean) as Array<ReturnType<typeof mergeBounds>>
    if (!memberBounds.length) continue

    const aggregateBounds = mergeBounds(memberBounds)
    const dx = parentBounds.centerX - aggregateBounds.centerX
    const dy = context.kind === 'numerator'
      ? parentBounds.top - Math.max(18, aggregateBounds.height * 0.85) - aggregateBounds.bottom
      : parentBounds.bottom + Math.max(18, aggregateBounds.height * 0.25) - aggregateBounds.top

    contextTranslationsByContextId.set(context.id, { dx, dy })

    for (const groupId of context.memberGroupIds) {
      const memberBounds = transformedBounds.get(groupId)
      if (!memberBounds) continue
      transformedBounds.set(groupId, getTranslatedBounds(memberBounds, dx, dy))
    }
  }

  for (const context of [...enclosureContexts].sort((left, right) => left.memberGroupIds.length - right.memberGroupIds.length)) {
    const boundaryIds = context.anchorGroupIds.filter((groupId) => {
      const roleName = roleMap.get(groupId)?.role || 'baseline'
      return roleName === 'enclosureOpen' || roleName === 'enclosureClose'
    })
    if (boundaryIds.length < 2) continue

    const contentGroupIds = context.memberGroupIds.filter((groupId) => !boundaryIds.includes(groupId))
    const boundaryBounds = boundaryIds
      .map((groupId) => transformedBounds.get(groupId))
      .filter(Boolean) as Array<ReturnType<typeof mergeBounds>>
    const contentBoundsList = contentGroupIds
      .map((groupId) => transformedBounds.get(groupId))
      .filter(Boolean) as Array<ReturnType<typeof mergeBounds>>
    if (boundaryBounds.length < 2 || !contentBoundsList.length) continue

    const leftBoundary = boundaryBounds.sort((left, right) => left.centerX - right.centerX)[0]
    const rightBoundary = boundaryBounds.sort((left, right) => left.centerX - right.centerX)[boundaryBounds.length - 1]
    const contentBounds = mergeBounds(contentBoundsList)
    const interiorLeft = leftBoundary.right + Math.max(8, leftBoundary.width * 0.18)
    const interiorRight = rightBoundary.left - Math.max(8, rightBoundary.width * 0.18)
    const interiorTop = Math.max(leftBoundary.top, rightBoundary.top) + Math.max(6, Math.min(leftBoundary.height, rightBoundary.height) * 0.08)
    const interiorBottom = Math.min(leftBoundary.bottom, rightBoundary.bottom) - Math.max(6, Math.min(leftBoundary.height, rightBoundary.height) * 0.08)
    const interiorWidth = Math.max(1, interiorRight - interiorLeft)
    const interiorHeight = Math.max(1, interiorBottom - interiorTop)
    if (interiorWidth <= 1 || interiorHeight <= 1) continue

    const targetWidth = interiorWidth * 0.7
    const targetHeight = interiorHeight * 0.68
    const scale = Math.max(0.88, Math.min(1.24, Math.min(targetWidth / Math.max(contentBounds.width, 1), targetHeight / Math.max(contentBounds.height, 1))))
    const targetCenterX = (interiorLeft + interiorRight) / 2
    const targetCenterY = (interiorTop + interiorBottom) / 2
    const dx = targetCenterX - contentBounds.centerX
    const dy = targetCenterY - contentBounds.centerY

    enclosureTransformsByContextId.set(context.id, {
      scale,
      centerX: contentBounds.centerX,
      centerY: contentBounds.centerY,
      dx,
      dy,
      memberGroupIds: contentGroupIds,
    })

    for (const groupId of contentGroupIds) {
      const memberBounds = transformedBounds.get(groupId)
      if (!memberBounds) continue
      transformedBounds.set(groupId, getScaledAndTranslatedBounds(memberBounds, contentBounds.centerX, contentBounds.centerY, scale, dx, dy))
    }
  }

  for (const group of ordered) {
    const role = roleMap.get(group.id)
    const scaledStrokes = scaledStrokesByGroupId.get(group.id)
    const scaledBounds = scaledBoundsByGroupId.get(group.id)
    const scale = scalesByGroupId.get(group.id)
    const localTranslation = localTranslationsByGroupId.get(group.id)
    if (!role || !scaledStrokes || !scaledBounds || !localTranslation || typeof scale !== 'number') continue
    const fractionMemberContextId = fractionMemberContextIdByGroupId.get(group.id) || null
    const contextTranslation = fractionMemberContextId ? contextTranslationsByContextId.get(fractionMemberContextId) || { dx: 0, dy: 0 } : { dx: 0, dy: 0 }
    let finalStrokes = scaledStrokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({
        ...point,
        x: point.x + localTranslation.dx + contextTranslation.dx,
        y: point.y + localTranslation.dy + contextTranslation.dy,
      })),
    }))

    for (const transform of enclosureTransformsByContextId.values()) {
      if (!transform.memberGroupIds.includes(group.id)) continue
      finalStrokes = finalStrokes.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => ({
          ...point,
          x: (point.x - transform.centerX) * transform.scale + transform.centerX + transform.dx,
          y: (point.y - transform.centerY) * transform.scale + transform.centerY + transform.dy,
        })),
      }))
    }

    const finalBounds = mergeBounds(finalStrokes.map(getStrokeBounds))

    transformedStrokes.push(...finalStrokes)
    transformedGroups.push({
      id: group.id,
      bounds: finalBounds,
      scale,
      translateX: finalBounds.centerX - scaledBounds.centerX,
      translateY: finalBounds.centerY - scaledBounds.centerY,
    })
  }

  return { strokes: transformedStrokes, groups: transformedGroups }
}