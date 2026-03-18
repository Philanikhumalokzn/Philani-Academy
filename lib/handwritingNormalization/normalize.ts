import { getStrokeBounds, mergeBounds, transformStroke } from './geometry'
import type { ExpressionContext, InkStroke, NormalizationResult, StrokeGroup, StructuralRole } from './types'

const getRoleScale = (role: StructuralRole) => {
  if (role.role === 'superscript' || role.role === 'subscript') return Math.max(0.42, 0.68 - role.depth * 0.1)
  if (role.role === 'numerator' || role.role === 'denominator') return 0.82
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

  const fractionMemberContexts = contexts.filter((context) => context.kind === 'numerator' || context.kind === 'denominator')
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
    const scale = getRoleScale(role)
    scalesByGroupId.set(group.id, scale)
    const anchor = { x: group.bounds.centerX, y: group.bounds.centerY }
    const scaledStrokes = group.strokes.map((stroke) => transformStroke(stroke, scale, anchor, 0, 0))
    const scaledBounds = mergeBounds(scaledStrokes.map(getStrokeBounds))
    scaledStrokesByGroupId.set(group.id, scaledStrokes)
    scaledBoundsByGroupId.set(group.id, scaledBounds)
    let dx = 0
    let dy = 0
    const fractionMemberContextId = fractionMemberContextIdByGroupId.get(group.id) || null
    const inFractionMemberContext = Boolean(fractionMemberContextId)

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

    const locallyTranslatedBounds = mergeBounds(scaledStrokes.map(getStrokeBounds).map((bounds) => ({
      ...bounds,
      left: bounds.left + dx,
      right: bounds.right + dx,
      top: bounds.top + dy,
      bottom: bounds.bottom + dy,
      centerX: bounds.centerX + dx,
      centerY: bounds.centerY + dy,
    })))

    transformedBounds.set(group.id, locallyTranslatedBounds)
  }

  for (const context of fractionMemberContexts) {
    const semanticRootRole = context.semanticRootGroupId ? roleMap.get(context.semanticRootGroupId) || null : null
    if (!semanticRootRole?.parentGroupId) continue
    const parentBounds = transformedBounds.get(semanticRootRole.parentGroupId) || groupMap.get(semanticRootRole.parentGroupId)?.bounds
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
      transformedBounds.set(groupId, {
        ...memberBounds,
        left: memberBounds.left + dx,
        right: memberBounds.right + dx,
        top: memberBounds.top + dy,
        bottom: memberBounds.bottom + dy,
        centerX: memberBounds.centerX + dx,
        centerY: memberBounds.centerY + dy,
      })
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
    const dx = localTranslation.dx + contextTranslation.dx
    const dy = localTranslation.dy + contextTranslation.dy

    const finalStrokes = scaledStrokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
    }))
    const finalBounds = mergeBounds(finalStrokes.map(getStrokeBounds))

    transformedStrokes.push(...finalStrokes)
    transformedGroups.push({
      id: group.id,
      bounds: finalBounds,
      scale,
      translateX: dx,
      translateY: dy,
    })
  }

  return { strokes: transformedStrokes, groups: transformedGroups }
}