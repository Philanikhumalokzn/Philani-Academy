import type { LayoutEdge, LocalSubexpression, StrokeGroup, StructuralAmbiguity, StructuralRole, StructuralRoleCandidate } from './types'

const FRACTION_BAR_MAX_HEIGHT = 18
const FRACTION_BAR_MIN_WIDTH = 54

const isFractionBarGroup = (group: StrokeGroup) => {
  return group.bounds.height <= FRACTION_BAR_MAX_HEIGHT && group.bounds.width >= FRACTION_BAR_MIN_WIDTH && group.aspectRatio >= 4
}

const bestIncoming = (edges: LayoutEdge[], groupId: string, kind: LayoutEdge['kind']) => {
  return edges
    .filter((edge) => edge.toId === groupId && edge.kind === kind)
    .sort((left, right) => right.score - left.score)[0] || null
}

const incomingByKind = (edges: LayoutEdge[], groupId: string, kind: LayoutEdge['kind']) => {
  return edges
    .filter((edge) => edge.toId === groupId && edge.kind === kind)
    .sort((left, right) => right.score - left.score)
}

const roleDepth = (roleMap: Map<string, StructuralRole>, groupId: string) => {
  let depth = 0
  let current = roleMap.get(groupId)
  let seen = 0
  while (current?.parentGroupId && seen < 8) {
    depth += 1
    current = roleMap.get(current.parentGroupId)
    seen += 1
  }
  return depth
}

const chooseBestCandidate = (candidates: StructuralRoleCandidate[]) => {
  return [...candidates].sort((left, right) => right.score - left.score)[0]
}

type StableAttachment = {
  parentId: string
  childId: string
  role: 'superscript' | 'subscript'
  score: number
}

type RootClaim = {
  rootGroupId: string
  role: 'baseline' | 'numerator' | 'denominator'
}

const collectStableAttachments = (groups: StrokeGroup[], edges: LayoutEdge[], blockedGroupIds: Set<string>) => {
  const attachments: StableAttachment[] = []
  const groupIds = new Set(groups.map((group) => group.id))

  for (const group of groups) {
    if (blockedGroupIds.has(group.id)) continue
    const bestSuper = incomingByKind(edges, group.id, 'superscriptCandidate')[0] || null
    const bestSub = incomingByKind(edges, group.id, 'subscriptCandidate')[0] || null
    const bestSequence = incomingByKind(edges, group.id, 'sequence')[0] || null

    const candidates = [
      bestSuper ? { edge: bestSuper, role: 'superscript' as const } : null,
      bestSub ? { edge: bestSub, role: 'subscript' as const } : null,
    ]
      .filter(Boolean)
      .sort((left, right) => (right?.edge.score || 0) - (left?.edge.score || 0))

    const best = candidates[0]
    if (!best) continue
    if (!groupIds.has(best.edge.fromId) || !groupIds.has(best.edge.toId)) continue
    if (blockedGroupIds.has(best.edge.fromId) || blockedGroupIds.has(best.edge.toId)) continue
    const sequenceScore = bestSequence?.score || 0
    if (best.edge.score < 0.48) continue
    if (sequenceScore > 0 && best.edge.score - sequenceScore < 0.12) continue

    attachments.push({
      parentId: best.edge.fromId,
      childId: best.edge.toId,
      role: best.role,
      score: best.edge.score,
    })
  }

  const childOwners = new Set<string>()
  const resolved: StableAttachment[] = []
  for (const attachment of attachments.sort((left, right) => right.score - left.score)) {
    if (childOwners.has(attachment.childId)) continue
    childOwners.add(attachment.childId)
    resolved.push(attachment)
  }

  return resolved
}

const buildLocalSubexpressions = (groups: StrokeGroup[], attachments: StableAttachment[], blockedGroupIds: Set<string>) => {
  const parentToChildren = new Map<string, StableAttachment[]>()
  const childToParent = new Map<string, StableAttachment>()
  const groupMap = new Map(groups.map((group) => [group.id, group]))

  for (const attachment of attachments) {
    if (!parentToChildren.has(attachment.parentId)) {
      parentToChildren.set(attachment.parentId, [])
    }
    parentToChildren.get(attachment.parentId)?.push(attachment)
    childToParent.set(attachment.childId, attachment)
  }

  const roots = groups
    .filter((group) => !blockedGroupIds.has(group.id))
    .filter((group) => !childToParent.has(group.id))
    .sort((left, right) => left.bounds.left - right.bounds.left)

  const subexpressions: LocalSubexpression[] = []
  const rootClaims = new Map<string, RootClaim>()

  const collectMembers = (rootId: string) => {
    const memberGroupIds: string[] = []
    const attachmentList: LocalSubexpression['attachments'] = []
    const stack = [rootId]
    while (stack.length) {
      const currentId = stack.pop() as string
      memberGroupIds.push(currentId)
      const children = parentToChildren.get(currentId) || []
      for (const child of children) {
        attachmentList.push({
          parentGroupId: child.parentId,
          childGroupId: child.childId,
          role: child.role,
          score: child.score,
        })
        stack.push(child.childId)
      }
    }
    memberGroupIds.sort((left, right) => (groupMap.get(left)?.bounds.left || 0) - (groupMap.get(right)?.bounds.left || 0))
    return { memberGroupIds, attachmentList }
  }

  for (const root of roots) {
    const { memberGroupIds, attachmentList } = collectMembers(root.id)
    rootClaims.set(root.id, { rootGroupId: root.id, role: 'baseline' })
    subexpressions.push({
      rootGroupId: root.id,
      memberGroupIds,
      attachments: attachmentList,
      rootRole: 'baseline',
    })
  }

  return { subexpressions, rootClaims }
}

const getSubexpressionBounds = (subexpression: LocalSubexpression, groupMap: Map<string, StrokeGroup>) => {
  const members = subexpression.memberGroupIds.map((groupId) => groupMap.get(groupId)).filter(Boolean) as StrokeGroup[]
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const member of members) {
    if (member.bounds.left < left) left = member.bounds.left
    if (member.bounds.top < top) top = member.bounds.top
    if (member.bounds.right > right) right = member.bounds.right
    if (member.bounds.bottom > bottom) bottom = member.bounds.bottom
  }
  return {
    left,
    top,
    right,
    bottom,
    centerX: left + (right - left) / 2,
  }
}

export const inferStructuralRoles = (groups: StrokeGroup[], edges: LayoutEdge[]) => {
  const roles = new Map<string, StructuralRole>()
  const ambiguities: StructuralAmbiguity[] = []
  const fractionBars = groups.filter(isFractionBarGroup)
  const fractionBarIds = new Set(fractionBars.map((group) => group.id))
  const stableAttachments = collectStableAttachments(groups, edges, fractionBarIds)
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const { subexpressions, rootClaims } = buildLocalSubexpressions(groups, stableAttachments, fractionBarIds)
  const childIds = new Set(stableAttachments.map((attachment) => attachment.childId))
  for (const bar of fractionBars) {
    roles.set(bar.id, {
      groupId: bar.id,
      role: 'fractionBar',
      score: 0.94,
      depth: 0,
      parentGroupId: null,
    })
  }

  for (const bar of fractionBars) {
    const numeratorRoots = subexpressions
      .filter((subexpression) => {
        const bounds = getSubexpressionBounds(subexpression, groupMap)
        if (bounds.bottom > bar.bounds.top + 16) return false
        if (bounds.right < bar.bounds.left || bounds.left > bar.bounds.right) return false
        return true
      })
      .sort((left, right) => getSubexpressionBounds(left, groupMap).left - getSubexpressionBounds(right, groupMap).left)

    const denominatorRoots = subexpressions
      .filter((subexpression) => {
        const bounds = getSubexpressionBounds(subexpression, groupMap)
        if (bounds.top < bar.bounds.bottom - 12) return false
        if (bounds.right < bar.bounds.left || bounds.left > bar.bounds.right) return false
        return true
      })
      .sort((left, right) => getSubexpressionBounds(left, groupMap).left - getSubexpressionBounds(right, groupMap).left)

    if (!numeratorRoots.length || !denominatorRoots.length) {
      continue
    }

    for (const numerator of numeratorRoots) {
      rootClaims.set(numerator.rootGroupId, { rootGroupId: numerator.rootGroupId, role: 'numerator' })
      const candidates: StructuralRoleCandidate[] = [
        { role: 'numerator', score: 0.82, parentGroupId: bar.id },
        { role: 'baseline', score: 0.36, parentGroupId: null },
      ]
      roles.set(numerator.rootGroupId, {
        groupId: numerator.rootGroupId,
        role: 'numerator',
        score: 0.82,
        depth: 1,
        parentGroupId: bar.id,
      })
      ambiguities.push({
        groupId: numerator.rootGroupId,
        reason: 'fraction-membership',
        chosenRole: 'numerator',
        candidates,
      })
    }

    for (const denominator of denominatorRoots) {
      rootClaims.set(denominator.rootGroupId, { rootGroupId: denominator.rootGroupId, role: 'denominator' })
      const candidates: StructuralRoleCandidate[] = [
        { role: 'denominator', score: 0.82, parentGroupId: bar.id },
        { role: 'baseline', score: 0.35, parentGroupId: null },
      ]
      roles.set(denominator.rootGroupId, {
        groupId: denominator.rootGroupId,
        role: 'denominator',
        score: 0.82,
        depth: 1,
        parentGroupId: bar.id,
      })
      ambiguities.push({
        groupId: denominator.rootGroupId,
        reason: 'fraction-membership',
        chosenRole: 'denominator',
        candidates,
      })
    }
  }

  for (const subexpression of subexpressions) {
    const rootClaim = rootClaims.get(subexpression.rootGroupId)
    subexpression.rootRole = rootClaim?.role || 'baseline'
    const shouldMaterializeRoot = subexpression.attachments.length > 0 || subexpression.rootRole !== 'baseline'
    if (shouldMaterializeRoot && !roles.has(subexpression.rootGroupId)) {
      roles.set(subexpression.rootGroupId, {
        groupId: subexpression.rootGroupId,
        role: subexpression.rootRole,
        score: subexpression.rootRole === 'baseline' ? 0.72 : 0.82,
        depth: 0,
        parentGroupId: null,
      })
    }
    for (const attachment of subexpression.attachments) {
      roles.set(attachment.childGroupId, {
        groupId: attachment.childGroupId,
        role: attachment.role,
        score: attachment.score,
        depth: 1,
        parentGroupId: attachment.parentGroupId,
      })
    }
  }

  const remaining = groups.filter((group) => !roles.has(group.id) && !fractionBarIds.has(group.id) && !childIds.has(group.id))
  for (const group of remaining) {
    const superCandidates = incomingByKind(edges, group.id, 'superscriptCandidate')
    const subCandidates = incomingByKind(edges, group.id, 'subscriptCandidate')
    const bestSuper = superCandidates[0] || null
    const bestSub = subCandidates[0] || null
    const bestSequence = bestIncoming(edges, group.id, 'sequence')
    const candidates: StructuralRoleCandidate[] = [{ role: 'baseline', score: 0.34, parentGroupId: null }]

    if (bestSuper) {
      candidates.push({ role: 'superscript', score: bestSuper.score, parentGroupId: bestSuper.fromId })
    }
    if (bestSub) {
      candidates.push({ role: 'subscript', score: bestSub.score, parentGroupId: bestSub.fromId })
    }

    if (bestSequence) {
      candidates.push({ role: 'baseline', score: Math.max(0.24, bestSequence.score * 0.88), parentGroupId: null })
    }

    const best = chooseBestCandidate(candidates)
    const sortedCandidates = [...candidates].sort((left, right) => right.score - left.score)
    const runnerUp = sortedCandidates[1]

    const parentRole = best.parentGroupId ? roles.get(best.parentGroupId) : null
    const parentSupportsAttachment = !parentRole || parentRole.role === 'baseline'

    if ((best.role === 'superscript' || best.role === 'subscript') && best.score >= 0.45 && best.parentGroupId && parentSupportsAttachment) {
      const nextRole: StructuralRole = {
        groupId: group.id,
        role: best.role,
        score: best.score,
        depth: 1,
        parentGroupId: best.parentGroupId,
      }
      roles.set(group.id, nextRole)
      if ((bestSequence && bestSequence.score >= 0.16 && Math.abs(best.score - bestSequence.score) <= 0.3) || (runnerUp && Math.abs(best.score - runnerUp.score) <= 0.14)) {
        ambiguities.push({
          groupId: group.id,
          reason: bestSequence && bestSequence.score >= 0.16 && Math.abs(best.score - bestSequence.score) <= 0.3 ? 'sequence-vs-script' : 'competing-relations',
          chosenRole: best.role,
          candidates: sortedCandidates.slice(0, 3),
        })
      }
      continue
    }

    roles.set(group.id, {
      groupId: group.id,
      role: 'baseline',
      score: sortedCandidates[0]?.score || 0.34,
      depth: 0,
      parentGroupId: null,
    })

    const closeScriptCandidate = [...superCandidates, ...subCandidates][0] || null
    if (
      (bestSequence && closeScriptCandidate && bestSequence.score >= 0.16 && closeScriptCandidate.score >= 0.45 && Math.abs(bestSequence.score - closeScriptCandidate.score) <= 0.34) ||
      (runnerUp && runnerUp.score >= 0.5 && Math.abs(sortedCandidates[0].score - runnerUp.score) <= 0.12)
    ) {
      ambiguities.push({
        groupId: group.id,
        reason: bestSequence && closeScriptCandidate && bestSequence.score >= 0.16 && Math.abs(bestSequence.score - closeScriptCandidate.score) <= 0.34 ? 'sequence-vs-script' : 'competing-relations',
        chosenRole: 'baseline',
        candidates: sortedCandidates.slice(0, 3),
      })
    }
  }

  for (const role of roles.values()) {
    role.depth = roleDepth(roles, role.groupId)
  }

  return {
    roles: groups
    .map((group) => roles.get(group.id) || {
      groupId: group.id,
      role: 'baseline' as const,
      score: 0.5,
      depth: 0,
      parentGroupId: null,
    })
    .sort((left, right) => left.depth - right.depth),
    subexpressions,
    ambiguities,
  }
}