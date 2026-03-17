import { clamp } from './geometry'
import { getRoleDescriptor, roleCanOwnScripts } from './roleTaxonomy'
import type { LayoutEdge, LocalSubexpression, StrokeGroup, StructuralAmbiguity, StructuralRole, StructuralRoleCandidate, StructuralRoleKind } from './types'

const FRACTION_BAR_MAX_HEIGHT = 18
const FRACTION_BAR_MIN_WIDTH = 70

const getFractionBarShapeScore = (group: StrokeGroup) => {
  const heightScore = clamp(1 - Math.max(group.bounds.height - FRACTION_BAR_MAX_HEIGHT, 0) / FRACTION_BAR_MAX_HEIGHT, 0, 1)
  const widthScore = clamp((group.bounds.width - FRACTION_BAR_MIN_WIDTH) / Math.max(18, FRACTION_BAR_MIN_WIDTH), 0, 1)
  const flatnessScore = clamp((group.aspectRatio - 3.4) / 3.4, 0, 1)
  return heightScore * 0.34 + widthScore * 0.24 + flatnessScore * 0.42
}

const isFractionBarLikeGroup = (group: StrokeGroup) => {
  return group.bounds.width >= FRACTION_BAR_MIN_WIDTH && getFractionBarShapeScore(group) >= 0.58
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

const makeCandidate = (role: StructuralRoleKind, score: number, parentGroupId?: string | null, evidence: string[] = []): StructuralRoleCandidate => ({
  role,
  score,
  parentGroupId: parentGroupId ?? null,
  evidence,
})

const makeRole = (groupId: string, role: StructuralRoleKind, score: number, depth: number, parentGroupId?: string | null, evidence: string[] = []): StructuralRole => ({
  groupId,
  role,
  descriptor: getRoleDescriptor(role),
  score,
  depth,
  parentGroupId: parentGroupId ?? null,
  evidence,
})

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
    centerY: top + (bottom - top) / 2,
  }
}

const mergeBounds = (boundsList: Array<ReturnType<typeof getSubexpressionBounds>>) => {
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const bounds of boundsList) {
    if (bounds.left < left) left = bounds.left
    if (bounds.top < top) top = bounds.top
    if (bounds.right > right) right = bounds.right
    if (bounds.bottom > bottom) bottom = bounds.bottom
  }
  return {
    left,
    top,
    right,
    bottom,
    centerX: left + (right - left) / 2,
    centerY: top + (bottom - top) / 2,
  }
}

const getWidthComparability = (referenceWidth: number, candidateWidth: number) => {
  const ratio = Math.max(referenceWidth, 1) / Math.max(candidateWidth, 1)
  if (ratio < 0.75) return clamp(ratio / 0.75, 0, 1)
  if (ratio <= 1.95) return 1
  return clamp(1 - (ratio - 1.95) / 1.4, 0, 1)
}

const scoreFractionMemberAlignment = (bar: StrokeGroup, memberBounds: ReturnType<typeof getSubexpressionBounds>) => {
  const centeredScore = clamp(1 - Math.abs(memberBounds.centerX - bar.bounds.centerX) / Math.max(24, bar.bounds.width * 0.38), 0, 1)
  const widthScore = getWidthComparability(bar.bounds.width, memberBounds.right - memberBounds.left)
  const overlapScore = clamp(Math.min(bar.bounds.right, memberBounds.right) - Math.max(bar.bounds.left, memberBounds.left), 0, bar.bounds.width) / Math.max(1, bar.bounds.width)
  return {
    centeredScore,
    widthScore,
    overlapScore,
    score: centeredScore * 0.5 + widthScore * 0.28 + overlapScore * 0.22,
  }
}

const scoreFractionContext = (bar: StrokeGroup, subexpressions: LocalSubexpression[], groupMap: Map<string, StrokeGroup>) => {
  const shapeScore = getFractionBarShapeScore(bar)
  const numeratorCandidates = subexpressions
    .map((subexpression) => ({ subexpression, bounds: getSubexpressionBounds(subexpression, groupMap) }))
    .filter(({ bounds }) => bounds.bottom <= bar.bounds.top + 24)
    .filter(({ bounds }) => {
      const centeredScore = clamp(1 - Math.abs(bounds.centerX - bar.bounds.centerX) / Math.max(24, bar.bounds.width * 0.5), 0, 1)
      const overlapWidth = Math.max(0, Math.min(bar.bounds.right, bounds.right) - Math.max(bar.bounds.left, bounds.left))
      return centeredScore >= 0.22 || overlapWidth >= Math.max(16, bar.bounds.width * 0.12)
    })

  const denominatorCandidates = subexpressions
    .map((subexpression) => ({ subexpression, bounds: getSubexpressionBounds(subexpression, groupMap) }))
    .filter(({ bounds }) => bounds.top >= bar.bounds.bottom - 12)
    .filter(({ bounds }) => {
      const centeredScore = clamp(1 - Math.abs(bounds.centerX - bar.bounds.centerX) / Math.max(24, bar.bounds.width * 0.5), 0, 1)
      const overlapWidth = Math.max(0, Math.min(bar.bounds.right, bounds.right) - Math.max(bar.bounds.left, bounds.left))
      return centeredScore >= 0.22 || overlapWidth >= Math.max(16, bar.bounds.width * 0.12)
    })

  const numeratorBounds = numeratorCandidates.length ? mergeBounds(numeratorCandidates.map((candidate) => candidate.bounds)) : null
  const denominatorBounds = denominatorCandidates.length ? mergeBounds(denominatorCandidates.map((candidate) => candidate.bounds)) : null
  const numeratorAggregate = numeratorBounds ? scoreFractionMemberAlignment(bar, numeratorBounds) : null
  const denominatorAggregate = denominatorBounds ? scoreFractionMemberAlignment(bar, denominatorBounds) : null
  const barRecognitionScore = numeratorAggregate
    ? shapeScore * 0.36 + numeratorAggregate.centeredScore * 0.34 + numeratorAggregate.widthScore * 0.18 + numeratorAggregate.overlapScore * 0.12
    : 0
  const memberClaimScore = numeratorAggregate && denominatorAggregate
    ? shapeScore * 0.22 + numeratorAggregate.centeredScore * 0.28 + denominatorAggregate.centeredScore * 0.28 + numeratorAggregate.widthScore * 0.12 + denominatorAggregate.overlapScore * 0.1
    : 0

  return {
    shapeScore,
    numeratorRoots: numeratorCandidates.map((candidate) => candidate.subexpression),
    denominatorRoots: denominatorCandidates.map((candidate) => candidate.subexpression),
    numeratorAggregate,
    denominatorAggregate,
    barRecognitionScore,
    memberClaimScore,
  }
}

export const inferStructuralRoles = (groups: StrokeGroup[], edges: LayoutEdge[]) => {
  const roles = new Map<string, StructuralRole>()
  const ambiguities: StructuralAmbiguity[] = []
  const fractionBarLikeGroups = groups.filter(isFractionBarLikeGroup)
  const fractionBarIds = new Set(fractionBarLikeGroups.map((group) => group.id))
  const stableAttachments = collectStableAttachments(groups, edges, fractionBarIds)
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const { subexpressions, rootClaims } = buildLocalSubexpressions(groups, stableAttachments, fractionBarIds)
  const childIds = new Set(stableAttachments.map((attachment) => attachment.childId))
  const confirmedFractionBars = fractionBarLikeGroups
    .map((bar) => ({ bar, context: scoreFractionContext(bar, subexpressions, groupMap) }))
    .filter(({ context }) => context.barRecognitionScore >= 0.5 && context.numeratorRoots.length > 0)

  for (const { bar, context } of confirmedFractionBars) {
    roles.set(bar.id, makeRole(bar.id, 'fractionBar', context.barRecognitionScore, 0, null, [
      `family=${getRoleDescriptor('fractionBar').family}`,
      `shape=${context.shapeScore.toFixed(2)}`,
      `centered-above=${context.numeratorAggregate?.centeredScore.toFixed(2) || '0.00'}`,
      `centered-below=${context.denominatorAggregate?.centeredScore.toFixed(2) || '0.00'}`,
      `width-match=${context.numeratorAggregate?.widthScore.toFixed(2) || '0.00'}`,
    ]))
  }

  for (const { bar, context } of confirmedFractionBars) {
    const numeratorRoots = context.memberClaimScore >= 0.46 && context.denominatorRoots.length > 0 ? context.numeratorRoots : []
    const denominatorRoots = context.memberClaimScore >= 0.46 && context.denominatorRoots.length > 0 ? context.denominatorRoots : []

    for (const numerator of numeratorRoots) {
      rootClaims.set(numerator.rootGroupId, { rootGroupId: numerator.rootGroupId, role: 'numerator' })
      const candidates: StructuralRoleCandidate[] = [
        makeCandidate('numerator', 0.82, bar.id, ['centered above confirmed fraction bar', 'inherits fraction-member ancestry']),
        makeCandidate('baseline', 0.36, null, ['fallback root role']),
      ]
      roles.set(numerator.rootGroupId, makeRole(numerator.rootGroupId, 'numerator', 0.82, 1, bar.id, [
        'centered above fraction structure',
        `ancestry=${getRoleDescriptor('numerator').ancestry.join('>')}`,
      ]))
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
        makeCandidate('denominator', 0.82, bar.id, ['centered below confirmed fraction bar', 'inherits fraction-member ancestry']),
        makeCandidate('baseline', 0.35, null, ['fallback root role']),
      ]
      roles.set(denominator.rootGroupId, makeRole(denominator.rootGroupId, 'denominator', 0.82, 1, bar.id, [
        'centered below fraction structure',
        `ancestry=${getRoleDescriptor('denominator').ancestry.join('>')}`,
      ]))
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
      roles.set(subexpression.rootGroupId, makeRole(
        subexpression.rootGroupId,
        subexpression.rootRole,
        subexpression.rootRole === 'baseline' ? 0.72 : 0.82,
        0,
        null,
        [
          'root of local subexpression',
          `family=${getRoleDescriptor(subexpression.rootRole).family}`,
        ],
      ))
    }
    for (const attachment of subexpression.attachments) {
      roles.set(attachment.childGroupId, makeRole(attachment.childGroupId, attachment.role, attachment.score, 1, attachment.parentGroupId, [
        'owned by local subexpression',
        `family=${getRoleDescriptor(attachment.role).family}`,
      ]))
    }
  }

  const remaining = groups.filter((group) => !roles.has(group.id) && !fractionBarIds.has(group.id) && !childIds.has(group.id))
  for (const group of remaining) {
    const superCandidates = incomingByKind(edges, group.id, 'superscriptCandidate')
    const subCandidates = incomingByKind(edges, group.id, 'subscriptCandidate')
    const bestSuper = superCandidates[0] || null
    const bestSub = subCandidates[0] || null
    const bestSequence = bestIncoming(edges, group.id, 'sequence')
    const candidates: StructuralRoleCandidate[] = [makeCandidate('baseline', 0.34, null, ['fallback root role'])]

    if (bestSuper) {
      candidates.push(makeCandidate('superscript', bestSuper.score, bestSuper.fromId, [
        `above-right=${bestSuper.metrics.dx > 0 && bestSuper.metrics.dy < 0 ? '1' : '0'}`,
        `size-ratio=${(bestSuper.metrics.sizeRatio || 0).toFixed(2)}`,
      ]))
    }
    if (bestSub) {
      candidates.push(makeCandidate('subscript', bestSub.score, bestSub.fromId, [
        `below-right=${(bestSub.metrics.belowRightScore || 0).toFixed(2)}`,
        `directly-below=${(bestSub.metrics.directlyBelowScore || 0).toFixed(2)}`,
        `width-ratio=${(bestSub.metrics.widthRatio || 0).toFixed(2)}`,
      ]))
    }

    if (bestSequence) {
      candidates.push(makeCandidate('baseline', Math.max(0.24, bestSequence.score * 0.88), null, ['inline sequence fallback']))
    }

    const best = chooseBestCandidate(candidates)
    const sortedCandidates = [...candidates].sort((left, right) => right.score - left.score)
    const runnerUp = sortedCandidates[1]

    const parentRole = best.parentGroupId ? roles.get(best.parentGroupId) : null
    const parentSupportsAttachment = Boolean(best.parentGroupId) && !fractionBarIds.has(best.parentGroupId) && (!parentRole || roleCanOwnScripts(parentRole.role))

    if ((best.role === 'superscript' || best.role === 'subscript') && best.score >= 0.45 && best.parentGroupId && parentSupportsAttachment) {
      const nextRole = makeRole(group.id, best.role, best.score, 1, best.parentGroupId, [
        ...(best.evidence || []),
        `parent-family=${parentRole ? parentRole.descriptor.family : 'expressionRoot'}`,
        `ancestry=${getRoleDescriptor(best.role).ancestry.join('>')}`,
      ])
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

    roles.set(group.id, makeRole(group.id, 'baseline', sortedCandidates[0]?.score || 0.34, 0, null, [
      'defaulted to baseline after candidate comparison',
      `family=${getRoleDescriptor('baseline').family}`,
    ]))

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
    .map((group) => roles.get(group.id) || makeRole(group.id, 'baseline', 0.5, 0, null, ['fallback default']))
    .sort((left, right) => left.depth - right.depth),
    subexpressions,
    ambiguities,
  }
}