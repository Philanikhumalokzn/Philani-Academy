import { getStrokeBounds, mergeBounds, transformStroke } from './geometry'
import type { InkStroke, NormalizationResult, StrokeGroup, StructuralRole } from './types'

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
  roleMap: Map<string, StructuralRole>,
  groupMap: Map<string, StrokeGroup>,
  transformedBounds: Map<string, ReturnType<typeof mergeBounds>>,
) => {
  if (!role.parentGroupId) return null
  const parentRole = roleMap.get(role.parentGroupId)
  const parentBounds = transformedBounds.get(role.parentGroupId) || groupMap.get(role.parentGroupId)?.bounds
  if (!parentBounds) return null
  if (!parentRole) return parentBounds

  const childContainerIds = new Set(role.containerGroupIds)
  const parentOnlyContainerIds = parentRole.containerGroupIds.filter((containerId) => !childContainerIds.has(containerId))
  if (!parentOnlyContainerIds.length) return parentBounds

  const broaderContextBounds = parentOnlyContainerIds
    .map((containerId) => transformedBounds.get(containerId) || groupMap.get(containerId)?.bounds)
    .filter(Boolean) as Array<ReturnType<typeof mergeBounds>>
  if (!broaderContextBounds.length) return parentBounds

  return mergeBounds([parentBounds, ...broaderContextBounds])
}

export const normalizeInkLayout = (groups: StrokeGroup[], roles: StructuralRole[]): NormalizationResult => {
  const roleMap = new Map(roles.map((role) => [role.groupId, role]))
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const transformedStrokes: InkStroke[] = []
  const transformedGroups: NormalizationResult['groups'] = []
  const transformedBounds = new Map<string, ReturnType<typeof mergeBounds>>()

  const baselineGroups = groups.filter((group) => isBaselineLikeRole(roleMap.get(group.id)?.role || 'baseline'))
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
    const anchor = { x: group.bounds.centerX, y: group.bounds.centerY }
    const scaledStrokes = group.strokes.map((stroke) => transformStroke(stroke, scale, anchor, 0, 0))
    const scaledBounds = mergeBounds(scaledStrokes.map(getStrokeBounds))
    let dx = 0
    let dy = 0

    if (isBaselineLikeRole(role.role)) {
      dy = baselineY - scaledBounds.bottom
      const targetHeight = baselineHeight
      const heightAdjust = targetHeight - scaledBounds.height
      dy -= heightAdjust * 0.18
    }

    if ((role.role === 'superscript' || role.role === 'subscript') && role.parentGroupId) {
      const parentBounds = getScriptAnchorBounds(role, roleMap, groupMap, transformedBounds)
      if (parentBounds) {
        dx = parentBounds.right + Math.max(8, parentBounds.width * 0.05) - scaledBounds.left
        dy = role.role === 'superscript'
          ? parentBounds.top + parentBounds.height * 0.12 - scaledBounds.bottom
          : parentBounds.bottom - parentBounds.height * 0.1 - scaledBounds.top
      }
    }

    if ((role.role === 'numerator' || role.role === 'denominator') && role.parentGroupId) {
      const parentBounds = transformedBounds.get(role.parentGroupId) || groupMap.get(role.parentGroupId)?.bounds
      if (parentBounds) {
        dx = parentBounds.centerX - scaledBounds.centerX
        dy = role.role === 'numerator'
          ? parentBounds.top - Math.max(18, scaledBounds.height * 0.85) - scaledBounds.bottom
          : parentBounds.bottom + Math.max(18, scaledBounds.height * 0.25) - scaledBounds.top
      }
    }

    if (role.role === 'fractionBar') {
      dy = baselineY - scaledBounds.centerY
    }

    const finalStrokes = scaledStrokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
    }))
    const finalBounds = mergeBounds(finalStrokes.map(getStrokeBounds))

    transformedBounds.set(group.id, finalBounds)
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