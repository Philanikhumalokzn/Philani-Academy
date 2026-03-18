import { clamp } from './geometry'
import { getRoleDescriptor, getRoleLocalityBias, roleAllowsChildRole, roleAllowsOperandRole, roleCanOwnScripts, roleRequiresOperandReference, roleUsesChildOperands, roleUsesParentOperand } from './roleTaxonomy'
import { annotateRolesWithRecognizedSymbols } from './symbolRecognition'
import type { EnclosureStructure, ExpressionContext, LayoutEdge, LocalSubexpression, StrokeGroup, StructuralAmbiguity, StructuralFlag, StructuralRole, StructuralRoleCandidate, StructuralRoleKind } from './types'

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

const makeCandidate = (
  role: StructuralRoleKind,
  score: number,
  parentGroupId?: string | null,
  evidence: string[] = [],
  options: Pick<StructuralRoleCandidate, 'associationContextId' | 'containerGroupIds' | 'normalizationAnchorGroupIds'> = {},
): StructuralRoleCandidate => ({
  role,
  score,
  parentGroupId: parentGroupId ?? null,
  associationContextId: options.associationContextId ?? null,
  containerGroupIds: options.containerGroupIds || [],
  normalizationAnchorGroupIds: options.normalizationAnchorGroupIds || [],
  evidence,
})

const makeRole = (groupId: string, role: StructuralRoleKind, score: number, depth: number, parentGroupId?: string | null, evidence: string[] = [], containerGroupIds: string[] = [], associationContextId?: string | null, normalizationAnchorGroupIds: string[] = []): StructuralRole => ({
  groupId,
  role,
  descriptor: getRoleDescriptor(role),
  score,
  depth,
  parentGroupId: parentGroupId ?? null,
  associationContextId: associationContextId ?? null,
  normalizationAnchorGroupIds,
  containerGroupIds,
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

type FractionStructureBinding = {
  barGroupId: string
  numeratorRootIds: string[]
  denominatorRootIds: string[]
}

const isSameContextStackedPair = (upper: StrokeGroup, lower: StrokeGroup) => {
  const overlapWidth = Math.max(0, Math.min(upper.bounds.right, lower.bounds.right) - Math.max(upper.bounds.left, lower.bounds.left))
  const minWidth = Math.max(1, Math.min(upper.bounds.width, lower.bounds.width))
  const horizontalAlignment = Math.abs(upper.bounds.centerX - lower.bounds.centerX) <= Math.max(26, (upper.bounds.width + lower.bounds.width) * 0.22)
  const verticallyStacked = lower.bounds.top > upper.bounds.bottom + 10 && lower.bounds.top - upper.bounds.bottom <= Math.max(140, (upper.bounds.height + lower.bounds.height) * 2.4)
  const sameColumn = overlapWidth / minWidth >= 0.18 || horizontalAlignment
  return verticallyStacked && sameColumn
}

const getSizeComparabilityScore = (reference: StrokeGroup, candidate: StrokeGroup) => {
  const heightRatio = Math.max(candidate.bounds.height, 1) / Math.max(reference.bounds.height, 1)
  const widthRatio = Math.max(candidate.bounds.width, 1) / Math.max(reference.bounds.width, 1)
  const heightScore = clamp(1 - Math.abs(heightRatio - 0.9) / 1.1, 0, 1)
  const widthScore = clamp(1 - Math.abs(widthRatio - 0.9) / 1.25, 0, 1)
  return heightScore * 0.62 + widthScore * 0.38
}

const getScriptLocalityScore = (role: StructuralRole, parent: StrokeGroup, candidate: StrokeGroup) => {
  const horizontalGap = Math.max(0, candidate.bounds.left - parent.bounds.right)
  const horizontalCloseness = clamp(1 - horizontalGap / Math.max(22, parent.bounds.width * 1.18), 0, 1)
  const targetY = role.role === 'superscript'
    ? parent.bounds.top + parent.bounds.height * 0.08
    : parent.bounds.bottom - parent.bounds.height * 0.08
  const verticalCloseness = role.role === 'superscript'
    ? clamp(1 - Math.abs(candidate.bounds.bottom - targetY) / Math.max(28, parent.bounds.height * 1.2), 0, 1)
    : clamp(1 - Math.abs(candidate.bounds.top - targetY) / Math.max(28, parent.bounds.height * 1.2), 0, 1)
  return horizontalCloseness * 0.58 + verticalCloseness * 0.42
}

const getScriptLocalityScoreByKind = (role: 'superscript' | 'subscript', parent: StrokeGroup, candidate: StrokeGroup) => {
  const horizontalGap = Math.max(0, candidate.bounds.left - parent.bounds.right)
  const horizontalCloseness = clamp(1 - horizontalGap / Math.max(22, parent.bounds.width * 1.18), 0, 1)
  const targetY = role === 'superscript'
    ? parent.bounds.top + parent.bounds.height * 0.08
    : parent.bounds.bottom - parent.bounds.height * 0.08
  const verticalCloseness = role === 'superscript'
    ? clamp(1 - Math.abs(candidate.bounds.bottom - targetY) / Math.max(28, parent.bounds.height * 1.2), 0, 1)
    : clamp(1 - Math.abs(candidate.bounds.top - targetY) / Math.max(28, parent.bounds.height * 1.2), 0, 1)
  return horizontalCloseness * 0.58 + verticalCloseness * 0.42
}

const demoteMissingOperandScripts = (roles: StructuralRole[]) => {
  const nextRoleMap = new Map(roles.map((role) => [role.groupId, role]))
  const flags: StructuralFlag[] = []

  for (const role of roles) {
    if ((role.role !== 'superscript' && role.role !== 'subscript') || role.parentGroupId) continue
    nextRoleMap.set(role.groupId, makeUnsupportedRole(role, [
      'missing required operand reference for unary operator',
      `required-parent=${String(roleRequiresOperandReference(role.role))}`,
    ]))
    flags.push({
      kind: 'missingOperandReference',
      severity: 'warning',
      groupIds: [role.groupId],
      operatorRole: role.role,
      message: `A ${role.role} candidate was preserved as ink but demoted because unary operators must reference a parent operand.`,
    })
  }

  return {
    roles: Array.from(nextRoleMap.values()),
    flags,
  }
}

const appendFractionWideScriptAmbiguities = (roles: StructuralRole[], groups: StrokeGroup[], contexts: ExpressionContext[], ambiguities: StructuralAmbiguity[]) => {
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const roleMap = new Map(roles.map((role) => [role.groupId, role]))
  const contextMap = new Map(contexts.map((context) => [context.id, context]))
  const nextAmbiguities = [...ambiguities]

  for (const role of roles) {
    if ((role.role !== 'superscript' && role.role !== 'subscript') || !role.parentGroupId) continue
    if (!role.associationContextId?.startsWith('context:fraction:')) continue
    const parentRole = roleMap.get(role.parentGroupId) || null
    if (!isFractionWideOutsideMember(role.groupId, parentRole, groupMap)) continue
    if (nextAmbiguities.some((ambiguity) => ambiguity.groupId === role.groupId && ambiguity.reason === 'fraction-wide-script-vs-baseline')) continue

    const detachedContextId = role.associationContextId ? contextMap.get(role.associationContextId)?.parentContextId || 'context:root' : 'context:root'

    nextAmbiguities.push({
      groupId: role.groupId,
      reason: 'fraction-wide-script-vs-baseline',
      chosenRole: role.role,
      candidates: [
        makeCandidate(role.role, role.score, role.parentGroupId, ['resolved as fraction-wide script promotion'], {
          associationContextId: role.associationContextId,
          containerGroupIds: role.containerGroupIds,
          normalizationAnchorGroupIds: role.normalizationAnchorGroupIds,
        }),
        makeCandidate('baseline', Math.max(0.28, role.score - 0.2), null, ['detached baseline alternative'], {
          associationContextId: detachedContextId,
        }),
      ],
    })
  }

  return nextAmbiguities
}

const appendEnclosureWideScriptAmbiguities = (roles: StructuralRole[], contexts: ExpressionContext[], ambiguities: StructuralAmbiguity[]) => {
  const contextMap = new Map(contexts.map((context) => [context.id, context]))
  const nextAmbiguities = [...ambiguities]

  for (const role of roles) {
    if ((role.role !== 'superscript' && role.role !== 'subscript') || !role.parentGroupId) continue
    if (!role.associationContextId?.startsWith('context:enclosure:')) continue
    if (role.containerGroupIds.length > 0) continue
    if (nextAmbiguities.some((ambiguity) => ambiguity.groupId === role.groupId && ambiguity.reason === 'enclosure-wide-script-vs-baseline')) continue

    const detachedContextId = contextMap.get(role.associationContextId)?.parentContextId || 'context:root'

    nextAmbiguities.push({
      groupId: role.groupId,
      reason: 'enclosure-wide-script-vs-baseline',
      chosenRole: role.role,
      candidates: [
        makeCandidate(role.role, role.score, role.parentGroupId, ['resolved as enclosure-wide script promotion'], {
          associationContextId: role.associationContextId,
          containerGroupIds: role.containerGroupIds,
          normalizationAnchorGroupIds: role.normalizationAnchorGroupIds,
        }),
        makeCandidate('baseline', Math.max(0.28, role.score - 0.2), null, ['detached baseline alternative'], {
          associationContextId: detachedContextId,
        }),
      ],
    })
  }

  return nextAmbiguities
}

const isFractionWideOutsideMember = (groupId: string, parentRole: StructuralRole | null, groupMap: Map<string, StrokeGroup>) => {
  if (!parentRole?.parentGroupId) return false
  if (parentRole.role !== 'numerator' && parentRole.role !== 'denominator') return false
  const fractionBarGroup = groupMap.get(parentRole.parentGroupId)
  const scriptGroup = groupMap.get(groupId)
  if (!fractionBarGroup || !scriptGroup) return false
  return scriptGroup.bounds.left >= fractionBarGroup.bounds.right + Math.max(10, fractionBarGroup.bounds.width * 0.08)
}

const isSameParentStackedScriptPair = (first: StrokeGroup, second: StrokeGroup) => {
  const upper = first.bounds.centerY <= second.bounds.centerY ? first : second
  const lower = upper.id === first.id ? second : first
  const overlapWidth = Math.max(0, Math.min(first.bounds.right, second.bounds.right) - Math.max(first.bounds.left, second.bounds.left))
  const minWidth = Math.max(1, Math.min(first.bounds.width, second.bounds.width))
  const sameColumn = overlapWidth / minWidth >= 0.14 || Math.abs(first.bounds.centerX - second.bounds.centerX) <= Math.max(22, (first.bounds.width + second.bounds.width) * 0.42)
  const clearlySeparatedRows = lower.bounds.centerY - upper.bounds.centerY >= Math.max(16, (first.bounds.height + second.bounds.height) * 0.38)
  return sameColumn && clearlySeparatedRows
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
  const barLocality = getRoleLocalityBias('fractionBar')
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
    ? shapeScore * 0.32 + numeratorAggregate.centeredScore * 0.36 + numeratorAggregate.widthScore * 0.2 + numeratorAggregate.overlapScore * 0.12
    : 0
  const memberClaimScore = numeratorAggregate && denominatorAggregate
    ? shapeScore * 0.18 + numeratorAggregate.centeredScore * 0.32 * barLocality.local + denominatorAggregate.centeredScore * 0.22 * barLocality.adjacent + numeratorAggregate.widthScore * 0.18 + denominatorAggregate.overlapScore * 0.1
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

const isEnclosureBoundaryCandidate = (group: StrokeGroup) => {
  const tallEnough = group.bounds.height >= 56
  const narrowEnough = group.bounds.width <= Math.max(34, group.bounds.height * 0.68)
  return tallEnough && narrowEnough && group.aspectRatio <= 0.75 && group.bounds.width > 6
}

const getEnclosureSemanticRootId = (
  enclosure: EnclosureStructure & { memberGroupIds: string[] },
  boundaryGroupId: string,
  groupMap: Map<string, StrokeGroup>,
) => {
  const roots = enclosure.memberRootIds
    .map((groupId) => groupMap.get(groupId))
    .filter(Boolean) as StrokeGroup[]
  if (!roots.length) return null
  if (boundaryGroupId === enclosure.closeGroupId) {
    return roots.sort((left, right) => right.bounds.right - left.bounds.right)[0]?.id || null
  }
  return roots.sort((left, right) => left.bounds.left - right.bounds.left)[0]?.id || null
}

const detectEnclosures = (groups: StrokeGroup[], subexpressions: LocalSubexpression[], groupMap: Map<string, StrokeGroup>, blockedGroupIds: Set<string>) => {
  const candidates = groups
    .filter((group) => !blockedGroupIds.has(group.id))
    .filter(isEnclosureBoundaryCandidate)
    .sort((left, right) => left.bounds.left - right.bounds.left)

  const rootsWithBounds = subexpressions.map((subexpression) => ({
    subexpression,
    bounds: getSubexpressionBounds(subexpression, groupMap),
  }))

  const scoredPairs: Array<EnclosureStructure & { memberGroupIds: string[] }> = []
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const open = candidates[leftIndex]
      const close = candidates[rightIndex]
      const members = rootsWithBounds.filter(({ bounds }) => {
        const insideHorizontally = bounds.left >= open.bounds.right - 10 && bounds.right <= close.bounds.left + 10
        const verticallyCovered = bounds.top >= Math.min(open.bounds.top, close.bounds.top) - 22 && bounds.bottom <= Math.max(open.bounds.bottom, close.bounds.bottom) + 22
        return insideHorizontally && verticallyCovered
      })
      if (!members.length) continue

      const contentBounds = mergeBounds(members.map((member) => member.bounds))
      const leftGap = contentBounds.left - open.bounds.right
      const rightGap = close.bounds.left - contentBounds.right
      if (leftGap < -10 || rightGap < -10) continue

      const heightSimilarity = clamp(1 - Math.abs(open.bounds.height - close.bounds.height) / Math.max(open.bounds.height, close.bounds.height, 1), 0, 1)
      const verticalAlignment = clamp(1 - Math.abs(open.bounds.centerY - close.bounds.centerY) / Math.max(24, Math.max(open.bounds.height, close.bounds.height) * 0.45), 0, 1)
      const contentCoverage = clamp(Math.min(open.bounds.bottom, close.bounds.bottom) - Math.max(open.bounds.top, close.bounds.top), 0, contentBounds.bottom - contentBounds.top + 24) / Math.max(24, contentBounds.bottom - contentBounds.top + 24)
      const innerSpacing = clamp(1 - (Math.max(leftGap, 0) + Math.max(rightGap, 0)) / Math.max(40, contentBounds.right - contentBounds.left + 40), 0, 1)
      const score = heightSimilarity * 0.26 + verticalAlignment * 0.24 + contentCoverage * 0.24 + innerSpacing * 0.26
      if (score < 0.64) continue

      const memberRootIds = members.map((member) => member.subexpression.rootGroupId)
      const memberGroupIds = members.flatMap((member) => member.subexpression.memberGroupIds)
      scoredPairs.push({
        id: `enclosure:${open.id}:${close.id}`,
        kind: 'parentheses',
        openGroupId: open.id,
        closeGroupId: close.id,
        memberRootIds,
        memberGroupIds,
        score,
      })
    }
  }

  const usedBoundaryIds = new Set<string>()
  const usedMemberIds = new Set<string>()
  const resolved: Array<EnclosureStructure & { memberGroupIds: string[] }> = []
  for (const pair of scoredPairs.sort((left, right) => right.score - left.score)) {
    if (usedBoundaryIds.has(pair.openGroupId) || usedBoundaryIds.has(pair.closeGroupId)) continue
    if (pair.memberRootIds.some((memberId) => usedMemberIds.has(memberId))) continue
    usedBoundaryIds.add(pair.openGroupId)
    usedBoundaryIds.add(pair.closeGroupId)
    for (const memberId of pair.memberRootIds) {
      usedMemberIds.add(memberId)
    }
    resolved.push(pair)
  }

  return resolved
}

const getRoleContextKey = (role: StructuralRole) => {
  const containers = [...role.containerGroupIds].sort().join(',') || 'root'
  return `parent:${role.parentGroupId || 'none'}|containers:${containers}`
}

const getScriptContextKey = (role: StructuralRole) => {
  const containers = [...role.containerGroupIds].sort().join(',') || 'root'
  return `role:${role.role}|parent:${role.parentGroupId || 'none'}|containers:${containers}`
}

const makeUnsupportedRole = (role: StructuralRole, evidence: string[]) => makeRole(
  role.groupId,
  'unsupportedSymbol',
  Math.max(role.score, 0.62),
  0,
  null,
  [
    ...role.evidence,
    ...evidence,
    `family=${getRoleDescriptor('unsupportedSymbol').family}`,
  ],
  role.containerGroupIds,
  role.associationContextId,
  role.normalizationAnchorGroupIds,
)

const uniqueIds = (values: string[]) => Array.from(new Set(values.filter(Boolean)))

const getOrderedRootIds = (rootIds: string[], groupMap: Map<string, StrokeGroup>) => {
  return uniqueIds(rootIds).sort((left, right) => {
    const leftGroup = groupMap.get(left)
    const rightGroup = groupMap.get(right)
    const leftX = leftGroup?.bounds.left || 0
    const rightX = rightGroup?.bounds.left || 0
    if (leftX !== rightX) return leftX - rightX
    return left.localeCompare(right)
  })
}

const expandCompositeMemberGroupIds = (
  rootIds: string[],
  subexpressions: LocalSubexpression[],
  roleMap: Map<string, StructuralRole>,
  enclosureContexts: ExpressionContext[],
  groupMap: Map<string, StrokeGroup>,
  fractionBarGroup?: StrokeGroup | null,
) => {
  const subexpressionByRootId = new Map(subexpressions.map((subexpression) => [subexpression.rootGroupId, subexpression]))
  const expandedGroupIds = new Set<string>()
  const pendingEnclosureKeySet = new Set<string>()
  const attachmentChildrenByParentId = new Map<string, string[]>()

  for (const subexpression of subexpressions) {
    for (const attachment of subexpression.attachments) {
      const existing = attachmentChildrenByParentId.get(attachment.parentGroupId) || []
      attachmentChildrenByParentId.set(attachment.parentGroupId, [...existing, attachment.childGroupId])
    }
  }

  for (const rootId of rootIds) {
    const subexpression = subexpressionByRootId.get(rootId)
    for (const groupId of subexpression?.memberGroupIds || [rootId]) {
      expandedGroupIds.add(groupId)
    }

    const role = roleMap.get(rootId)
    for (const containerGroupId of role?.containerGroupIds || []) {
      pendingEnclosureKeySet.add(containerGroupId)
    }
  }

  if (fractionBarGroup) {
    const excludedGroupIds = new Set<string>()
    const excludedRoots = rootIds.flatMap((rootId) => {
      const subexpression = subexpressionByRootId.get(rootId)
      return (subexpression?.memberGroupIds || []).filter((groupId) => {
        if (groupId === rootId) return false
        const memberRole = roleMap.get(groupId)
        const memberGroup = groupMap.get(groupId)
        if (!memberRole || !memberGroup) return false
        if ((memberRole.role !== 'superscript' && memberRole.role !== 'subscript') || memberRole.parentGroupId !== rootId) return false
        return memberGroup.bounds.left >= fractionBarGroup.bounds.right + Math.max(10, fractionBarGroup.bounds.width * 0.08)
      })
    })

    const stack = [...excludedRoots]
    while (stack.length) {
      const currentId = stack.pop() as string
      if (excludedGroupIds.has(currentId)) continue
      excludedGroupIds.add(currentId)
      for (const childId of attachmentChildrenByParentId.get(currentId) || []) {
        stack.push(childId)
      }
    }

    for (const groupId of excludedGroupIds) {
      expandedGroupIds.delete(groupId)
    }
  }

  const enclosureContextsToMerge = enclosureContexts.filter((context) => context.anchorGroupIds.some((groupId) => pendingEnclosureKeySet.has(groupId)))
  for (const context of enclosureContextsToMerge) {
    for (const groupId of context.memberGroupIds) {
      expandedGroupIds.add(groupId)
    }
  }

  return uniqueIds(Array.from(expandedGroupIds))
}

const buildExpressionContexts = (
  groups: StrokeGroup[],
  roles: StructuralRole[],
  subexpressions: LocalSubexpression[],
  enclosures: EnclosureStructure[],
  fractionBindings: FractionStructureBinding[],
) => {
  const contexts: ExpressionContext[] = []
  const roleMap = new Map(roles.map((role) => [role.groupId, role]))
  const groupMap = new Map(groups.map((group) => [group.id, group]))

  contexts.push({
    id: 'context:root',
    kind: 'root',
    parentContextId: null,
    semanticRootGroupId: null,
    anchorGroupIds: uniqueIds(roles.filter((role) => role.role === 'baseline' && role.containerGroupIds.length === 0).map((role) => role.groupId)),
    memberGroupIds: groups.filter((group) => (roleMap.get(group.id)?.containerGroupIds.length || 0) === 0).map((group) => group.id),
  })

  for (const enclosure of enclosures) {
    const memberRoles = enclosure.memberRootIds.map((groupId) => roleMap.get(groupId)).filter(Boolean) as StructuralRole[]
    const enclosedGroupIds = roles
      .filter((role) => role.containerGroupIds.includes(enclosure.openGroupId) && role.containerGroupIds.includes(enclosure.closeGroupId))
      .map((role) => role.groupId)
    const semanticRoot = memberRoles.sort((left, right) => {
      const leftIsBaseline = left.role === 'baseline' ? 0 : 1
      const rightIsBaseline = right.role === 'baseline' ? 0 : 1
      if (leftIsBaseline !== rightIsBaseline) return leftIsBaseline - rightIsBaseline
      return left.groupId.localeCompare(right.groupId)
    })[0] || null
    const outerContainerGroupIds = (semanticRoot?.containerGroupIds || [])
      .filter((groupId) => groupId !== enclosure.openGroupId && groupId !== enclosure.closeGroupId)
    const parentContextId = outerContainerGroupIds.length ? `context:enclosure:${outerContainerGroupIds.join(':')}` : 'context:root'
    contexts.push({
      id: `context:enclosure:${enclosure.openGroupId}:${enclosure.closeGroupId}`,
      kind: 'enclosure',
      parentContextId,
      semanticRootGroupId: semanticRoot?.groupId || enclosure.memberRootIds[0] || null,
      anchorGroupIds: uniqueIds([enclosure.openGroupId, enclosure.closeGroupId, ...(semanticRoot ? [semanticRoot.groupId] : [])]),
      memberGroupIds: uniqueIds([enclosure.openGroupId, enclosure.closeGroupId, ...enclosure.memberRootIds, ...enclosedGroupIds]),
    })
  }

  const enclosureContexts = contexts.filter((context) => context.kind === 'enclosure')

  for (const fractionBarRole of roles.filter((role) => role.role === 'fractionBar')) {
    const binding = fractionBindings.find((candidate) => candidate.barGroupId === fractionBarRole.groupId) || null
    const numeratorRole = roles.find((role) => role.parentGroupId === fractionBarRole.groupId && role.role === 'numerator') || null
    const denominatorRole = roles.find((role) => role.parentGroupId === fractionBarRole.groupId && role.role === 'denominator') || null
    const numeratorRootIds = getOrderedRootIds(binding?.numeratorRootIds || (numeratorRole ? [numeratorRole.groupId] : []), groupMap)
    const denominatorRootIds = getOrderedRootIds(binding?.denominatorRootIds || (denominatorRole ? [denominatorRole.groupId] : []), groupMap)
    const fractionBarGroup = groupMap.get(fractionBarRole.groupId) || null
    const numeratorMembers = expandCompositeMemberGroupIds(numeratorRootIds, subexpressions, roleMap, enclosureContexts, groupMap, fractionBarGroup)
    const denominatorMembers = expandCompositeMemberGroupIds(denominatorRootIds, subexpressions, roleMap, enclosureContexts, groupMap, fractionBarGroup)
    const parentContextId = fractionBarRole.containerGroupIds.length
      ? `context:enclosure:${fractionBarRole.containerGroupIds.join(':')}`
      : 'context:root'

    contexts.push({
      id: `context:fraction:${fractionBarRole.groupId}`,
      kind: 'fraction',
      parentContextId,
      semanticRootGroupId: fractionBarRole.groupId,
      anchorGroupIds: uniqueIds([fractionBarRole.groupId, ...(numeratorRole ? [numeratorRole.groupId] : []), ...(denominatorRole ? [denominatorRole.groupId] : [])]),
      memberGroupIds: uniqueIds([fractionBarRole.groupId, ...numeratorMembers, ...denominatorMembers]),
    })

    if (numeratorRole && numeratorMembers.length) {
      contexts.push({
        id: `context:numerator:${numeratorRole.groupId}`,
        kind: 'numerator',
        parentContextId: `context:fraction:${fractionBarRole.groupId}`,
        semanticRootGroupId: numeratorRole.groupId,
        anchorGroupIds: uniqueIds([fractionBarRole.groupId, numeratorRole.groupId]),
        memberGroupIds: numeratorMembers,
      })
    }

    if (denominatorRole && denominatorMembers.length) {
      contexts.push({
        id: `context:denominator:${denominatorRole.groupId}`,
        kind: 'denominator',
        parentContextId: `context:fraction:${fractionBarRole.groupId}`,
        semanticRootGroupId: denominatorRole.groupId,
        anchorGroupIds: uniqueIds([fractionBarRole.groupId, denominatorRole.groupId]),
        memberGroupIds: denominatorMembers,
      })
    }
  }

  return contexts
}

const annotateRolesWithContexts = (roles: StructuralRole[], contexts: ExpressionContext[], groups: StrokeGroup[]) => {
  const roleMap = new Map(roles.map((role) => [role.groupId, role]))
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const enclosureContexts = contexts.filter((context) => context.kind === 'enclosure')
  const fractionContexts = contexts.filter((context) => context.kind === 'fraction')
  const fractionMemberContexts = contexts.filter((context) => context.kind === 'numerator' || context.kind === 'denominator')

  return roles.map((role) => {
    if ((role.role !== 'superscript' && role.role !== 'subscript') || !role.parentGroupId) {
      const defaultContextId = role.containerGroupIds.length
        ? enclosureContexts.find((context) => role.containerGroupIds.every((groupId) => context.anchorGroupIds.includes(groupId)))?.id || 'context:root'
        : 'context:root'
      return {
        ...role,
        associationContextId: role.associationContextId || defaultContextId,
        normalizationAnchorGroupIds: role.normalizationAnchorGroupIds.length ? role.normalizationAnchorGroupIds : [role.groupId],
      }
    }

    const parentRole = roleMap.get(role.parentGroupId)
    const childContainerIds = new Set(role.containerGroupIds)
    const parentOnlyContainers = (parentRole?.containerGroupIds || []).filter((groupId) => !childContainerIds.has(groupId))
    const enclosureContext = parentOnlyContainers.length
      ? enclosureContexts.find((context) => parentOnlyContainers.every((groupId) => context.anchorGroupIds.includes(groupId))) || null
      : null
    const sharedFractionMemberContext = fractionMemberContexts.find((context) => context.memberGroupIds.includes(role.groupId) && context.memberGroupIds.includes(role.parentGroupId || '')) || null
    const fractionContext = parentRole?.parentGroupId
      ? fractionContexts.find((context) => context.semanticRootGroupId === parentRole.parentGroupId && context.memberGroupIds.includes(parentRole.groupId)) || null
      : null
    const fractionWideOutsideMember = Boolean(sharedFractionMemberContext) && isFractionWideOutsideMember(role.groupId, parentRole || null, groupMap)

    if (!enclosureContext && fractionContext && (!sharedFractionMemberContext || fractionWideOutsideMember)) {
      const anchorGroupIds = uniqueIds(fractionContext.anchorGroupIds)
      return {
        ...role,
        associationContextId: fractionContext.id,
        normalizationAnchorGroupIds: anchorGroupIds,
        evidence: [...role.evidence, `association-context=${fractionContext.id}`, `normalization-anchors=${anchorGroupIds.join(',')}`],
      }
    }

    if (!enclosureContext) {
      return {
        ...role,
        associationContextId: role.associationContextId || sharedFractionMemberContext?.id || (role.containerGroupIds.length ? `context:enclosure:${role.containerGroupIds.join(':')}` : 'context:root'),
        normalizationAnchorGroupIds: role.normalizationAnchorGroupIds.length ? role.normalizationAnchorGroupIds : [role.parentGroupId],
      }
    }

    const anchorGroupIds = uniqueIds([role.parentGroupId, ...enclosureContext.anchorGroupIds])
    return {
      ...role,
      associationContextId: enclosureContext.id,
      normalizationAnchorGroupIds: anchorGroupIds,
      evidence: [...role.evidence, `association-context=${enclosureContext.id}`, `normalization-anchors=${anchorGroupIds.join(',')}`],
    }
  }).map((role) => ({
    ...role,
    associationContextId: role.associationContextId || 'context:root',
    normalizationAnchorGroupIds: role.normalizationAnchorGroupIds.length ? role.normalizationAnchorGroupIds : [role.groupId],
  }))
}

const resolveStructuralAdmissibility = (groups: StrokeGroup[], roles: StructuralRole[], edges: LayoutEdge[]) => {
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const roleMap = new Map(roles.map((role) => [role.groupId, role]))
  const baselineRoles = roles.filter((role) => role.role === 'baseline')
  const byContext = new Map<string, StructuralRole[]>()

  for (const role of baselineRoles) {
    const contextKey = getRoleContextKey(role)
    const bucket = byContext.get(contextKey) || []
    bucket.push(role)
    byContext.set(contextKey, bucket)
  }

  const flags: StructuralFlag[] = []
  for (const [contextKey, bucket] of byContext.entries()) {
    const ordered = [...bucket].sort((left, right) => {
      const topDelta = (groupMap.get(left.groupId)?.bounds.top || 0) - (groupMap.get(right.groupId)?.bounds.top || 0)
      if (topDelta !== 0) return topDelta
      return (groupMap.get(left.groupId)?.bounds.left || 0) - (groupMap.get(right.groupId)?.bounds.left || 0)
    })
    const keptBaselineIds: string[] = []

    for (const candidate of ordered) {
      const candidateGroup = groupMap.get(candidate.groupId)
      if (!candidateGroup) continue

      const conflictingKeptRole = keptBaselineIds
        .map((groupId) => roleMap.get(groupId))
        .find((keptRole) => {
          if (!keptRole) return false
          const keptGroup = groupMap.get(keptRole.groupId)
          if (!keptGroup) return false
          return keptGroup.bounds.top <= candidateGroup.bounds.top
            ? isSameContextStackedPair(keptGroup, candidateGroup)
            : isSameContextStackedPair(candidateGroup, keptGroup)
        })

      if (!conflictingKeptRole) {
        keptBaselineIds.push(candidate.groupId)
        continue
      }

      roleMap.set(candidate.groupId, makeUnsupportedRole(candidate, [
        'unsupported same-context stacked baseline',
        `conflicts-with=${conflictingKeptRole.groupId}`,
      ]))
      flags.push({
        kind: 'sameContextStackedBaselines',
        severity: 'warning',
        groupIds: [conflictingKeptRole.groupId, candidate.groupId],
        contextKey,
        message: 'Multiple baseline candidates occupy vertically stacked positions in the same local context. The lower conflicting group was preserved as ink but demoted from baseline to unsupportedSymbol.',
      })
    }
  }

  const scriptBuckets = new Map<string, StructuralRole[]>()
  for (const role of roleMap.values()) {
    if (role.role !== 'superscript' && role.role !== 'subscript') continue
    if (!role.parentGroupId) continue
    const contextKey = getScriptContextKey(role)
    const bucket = scriptBuckets.get(contextKey) || []
    bucket.push(role)
    scriptBuckets.set(contextKey, bucket)
  }

  for (const [contextKey, bucket] of scriptBuckets.entries()) {
    if (bucket.length < 2) continue
    const parentGroupId = bucket[0]?.parentGroupId || null
    if (!parentGroupId) continue
    const parentGroup = groupMap.get(parentGroupId)
    if (!parentGroup) continue

    const ordered = [...bucket].sort((left, right) => {
      const leftGroup = groupMap.get(left.groupId)
      const rightGroup = groupMap.get(right.groupId)
      if (!leftGroup || !rightGroup) return 0
      const leftScore = getScriptLocalityScore(left, parentGroup, leftGroup) * 0.78 + getSizeComparabilityScore(parentGroup, leftGroup) * 0.22
      const rightScore = getScriptLocalityScore(right, parentGroup, rightGroup) * 0.78 + getSizeComparabilityScore(parentGroup, rightGroup) * 0.22
      return rightScore - leftScore
    })

    const keptScriptIds: string[] = []
    for (const candidate of ordered) {
      const candidateGroup = groupMap.get(candidate.groupId)
      if (!candidateGroup) continue
      const conflictingKeptRole = keptScriptIds
        .map((groupId) => roleMap.get(groupId))
        .find((keptRole) => {
          if (!keptRole) return false
          const keptGroup = groupMap.get(keptRole.groupId)
          if (!keptGroup) return false
          return isSameParentStackedScriptPair(keptGroup, candidateGroup)
        })

      if (!conflictingKeptRole) {
        keptScriptIds.push(candidate.groupId)
        continue
      }

      roleMap.set(candidate.groupId, makeUnsupportedRole(candidate, [
        `unsupported same-parent stacked ${candidate.role}`,
        `conflicts-with=${conflictingKeptRole.groupId}`,
        'spatial closeness dominates size comparability when resolving local script siblings',
      ]))
      const scriptRole = candidate.role === 'superscript' ? 'superscript' : 'subscript'
      flags.push({
        kind: 'sameParentStackedScripts',
        severity: 'warning',
        groupIds: [conflictingKeptRole.groupId, candidate.groupId],
        contextKey,
        parentGroupId,
        scriptRole,
        message: `Multiple ${scriptRole} candidates stack in the same local context around one parent. The weaker sibling was preserved as ink but demoted to unsupportedSymbol.`,
      })
    }
  }

  const baselineFallbacks = Array.from(roleMap.values()).filter((role) => role.role === 'baseline')
  for (const role of baselineFallbacks) {
    const candidateGroup = groupMap.get(role.groupId)
    if (!candidateGroup) continue

    const scriptEvidence = [
      {
        role: 'superscript' as const,
        edge: incomingByKind(edges, role.groupId, 'superscriptCandidate')[0] || null,
      },
      {
        role: 'subscript' as const,
        edge: incomingByKind(edges, role.groupId, 'subscriptCandidate')[0] || null,
      },
    ]
      .filter((entry) => entry.edge && entry.edge.score >= 0.3)
      .sort((left, right) => (right.edge?.score || 0) - (left.edge?.score || 0))[0] || null

    if (!scriptEvidence?.edge) continue

    const siblingScript = Array.from(roleMap.values()).find((candidateRole) => {
      if (candidateRole.role !== scriptEvidence.role) return false
      if (candidateRole.parentGroupId !== scriptEvidence.edge?.fromId) return false
      const sameContainers = [...candidateRole.containerGroupIds].sort().join(',') === [...role.containerGroupIds].sort().join(',')
      if (!sameContainers) return false
      const siblingGroup = groupMap.get(candidateRole.groupId)
      if (!siblingGroup) return false
      return isSameParentStackedScriptPair(siblingGroup, candidateGroup)
    })

    if (!siblingScript || !scriptEvidence.edge.fromId) continue

    roleMap.set(role.groupId, makeUnsupportedRole(role, [
      `unsupported same-parent stacked ${scriptEvidence.role}`,
      `conflicts-with=${siblingScript.groupId}`,
      `candidate-parent=${scriptEvidence.edge.fromId}`,
      'baseline fallback was rejected because local script spatiality remained stronger',
    ]))
    flags.push({
      kind: 'sameParentStackedScripts',
      severity: 'warning',
      groupIds: [siblingScript.groupId, role.groupId],
      contextKey: `role:${scriptEvidence.role}|parent:${scriptEvidence.edge.fromId}|containers:${[...role.containerGroupIds].sort().join(',') || 'root'}`,
      parentGroupId: scriptEvidence.edge.fromId,
      scriptRole: scriptEvidence.role,
      message: `A baseline fallback still carried strong ${scriptEvidence.role} evidence in the same local context as an existing sibling script. It was preserved as ink but demoted to unsupportedSymbol.`,
    })
  }

  return {
    roles: Array.from(roleMap.values())
      .map((role) => ({ ...role, depth: role.parentGroupId ? roleDepth(roleMap, role.groupId) : 0 }))
      .sort((left, right) => left.depth - right.depth),
    flags,
  }
}

export const inferStructuralRoles = (groups: StrokeGroup[], edges: LayoutEdge[]) => {
  const roles = new Map<string, StructuralRole>()
  const ambiguities: StructuralAmbiguity[] = []
  const fractionBarLikeGroups = groups.filter(isFractionBarLikeGroup)
  const fractionBarIds = new Set(fractionBarLikeGroups.map((group) => group.id))
  const enclosureBoundaryIds = new Set(groups.filter(isEnclosureBoundaryCandidate).map((group) => group.id))
  const blockedAttachmentIds = new Set<string>([...fractionBarIds, ...enclosureBoundaryIds])
  const stableAttachments = collectStableAttachments(groups, edges, blockedAttachmentIds)
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const { subexpressions, rootClaims } = buildLocalSubexpressions(groups, stableAttachments, fractionBarIds)
  const childIds = new Set(stableAttachments.map((attachment) => attachment.childId))
  const enclosures = detectEnclosures(groups, subexpressions, groupMap, fractionBarIds)
  const fractionBindings: FractionStructureBinding[] = []
  const containerIdsByGroupId = new Map<string, string[]>()
  const enclosureByBoundaryId = new Map<string, EnclosureStructure & { memberGroupIds: string[] }>()

  for (const enclosure of enclosures) {
    enclosureByBoundaryId.set(enclosure.openGroupId, enclosure)
    enclosureByBoundaryId.set(enclosure.closeGroupId, enclosure)
    roles.set(enclosure.openGroupId, makeRole(enclosure.openGroupId, 'enclosureOpen', enclosure.score, 0, null, [
      'left enclosure boundary',
      `members=${enclosure.memberRootIds.join(',')}`,
      `peers=${getRoleDescriptor('enclosureOpen').peerRoles.join(',')}`,
    ]))
    roles.set(enclosure.closeGroupId, makeRole(enclosure.closeGroupId, 'enclosureClose', enclosure.score, 0, null, [
      'right enclosure boundary',
      `members=${enclosure.memberRootIds.join(',')}`,
      `peers=${getRoleDescriptor('enclosureClose').peerRoles.join(',')}`,
    ]))
    for (const memberGroupId of enclosure.memberGroupIds) {
      const current = containerIdsByGroupId.get(memberGroupId) || []
      containerIdsByGroupId.set(memberGroupId, [...current, enclosure.openGroupId, enclosure.closeGroupId])
    }
  }

  const confirmedFractionBars = fractionBarLikeGroups
    .map((bar) => ({ bar, context: scoreFractionContext(bar, subexpressions, groupMap) }))
    .filter(({ context }) => context.barRecognitionScore >= 0.5 && context.numeratorRoots.length > 0)

  for (const { bar, context } of confirmedFractionBars) {
    roles.set(bar.id, makeRole(bar.id, 'fractionBar', context.barRecognitionScore, 0, null, [
      `family=${getRoleDescriptor('fractionBar').family}`,
      `operator-kind=${getRoleDescriptor('fractionBar').operatorKind}`,
      `operand-mode=${getRoleDescriptor('fractionBar').operandReferenceMode}`,
      `allowed-operands=${getRoleDescriptor('fractionBar').allowedOperandRoles.join(',')}`,
      `allowed-children=${getRoleDescriptor('fractionBar').allowedChildRoles.join(',')}`,
      `forbidden-children=${getRoleDescriptor('fractionBar').forbiddenChildRoles.join(',')}`,
      `shape=${context.shapeScore.toFixed(2)}`,
      `centered-above=${context.numeratorAggregate?.centeredScore.toFixed(2) || '0.00'}`,
      `centered-below=${context.denominatorAggregate?.centeredScore.toFixed(2) || '0.00'}`,
      `width-match=${context.numeratorAggregate?.widthScore.toFixed(2) || '0.00'}`,
    ]))
  }

  for (const { bar, context } of confirmedFractionBars) {
    const numeratorRoots = context.memberClaimScore >= 0.46 && context.denominatorRoots.length > 0 ? getOrderedRootIds(context.numeratorRoots.map((candidate) => candidate.rootGroupId), groupMap) : []
    const denominatorRoots = context.memberClaimScore >= 0.46 && context.denominatorRoots.length > 0 ? getOrderedRootIds(context.denominatorRoots.map((candidate) => candidate.rootGroupId), groupMap) : []
    const numeratorPrimaryRootId = numeratorRoots[0] || null
    const denominatorPrimaryRootId = denominatorRoots[0] || null

    fractionBindings.push({
      barGroupId: bar.id,
      numeratorRootIds: numeratorRoots,
      denominatorRootIds: denominatorRoots,
    })

    if (numeratorPrimaryRootId) {
      if (!roleUsesChildOperands('fractionBar') || !roleAllowsChildRole('fractionBar', 'numerator') || !roleAllowsOperandRole('fractionBar', 'numerator')) continue
      rootClaims.set(numeratorPrimaryRootId, { rootGroupId: numeratorPrimaryRootId, role: 'numerator' })
      const candidates: StructuralRoleCandidate[] = [
        makeCandidate('numerator', 0.82, bar.id, ['centered above confirmed fraction bar', 'inherits fraction-member ancestry']),
        makeCandidate('baseline', 0.36, null, ['fallback root role']),
      ]
      roles.set(numeratorPrimaryRootId, makeRole(numeratorPrimaryRootId, 'numerator', 0.82, 1, bar.id, [
        'centered above fraction structure',
        `ancestry=${getRoleDescriptor('numerator').ancestry.join('>')}`,
      ], containerIdsByGroupId.get(numeratorPrimaryRootId) || []))
      ambiguities.push({
        groupId: numeratorPrimaryRootId,
        reason: 'fraction-membership',
        chosenRole: 'numerator',
        candidates,
      })
    }

    if (denominatorPrimaryRootId) {
      if (!roleUsesChildOperands('fractionBar') || !roleAllowsChildRole('fractionBar', 'denominator') || !roleAllowsOperandRole('fractionBar', 'denominator')) continue
      rootClaims.set(denominatorPrimaryRootId, { rootGroupId: denominatorPrimaryRootId, role: 'denominator' })
      const candidates: StructuralRoleCandidate[] = [
        makeCandidate('denominator', 0.82, bar.id, ['centered below confirmed fraction bar', 'inherits fraction-member ancestry']),
        makeCandidate('baseline', 0.35, null, ['fallback root role']),
      ]
      roles.set(denominatorPrimaryRootId, makeRole(denominatorPrimaryRootId, 'denominator', 0.82, 1, bar.id, [
        'centered below fraction structure',
        `ancestry=${getRoleDescriptor('denominator').ancestry.join('>')}`,
      ], containerIdsByGroupId.get(denominatorPrimaryRootId) || []))
      ambiguities.push({
        groupId: denominatorPrimaryRootId,
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
          `allowed-children=${getRoleDescriptor(subexpression.rootRole).allowedChildRoles.join(',') || 'none'}`,
          `forbidden-children=${getRoleDescriptor(subexpression.rootRole).forbiddenChildRoles.join(',') || 'none'}`,
        ],
        containerIdsByGroupId.get(subexpression.rootGroupId) || [],
      ))
    }
    for (const attachment of subexpression.attachments) {
      roles.set(attachment.childGroupId, makeRole(attachment.childGroupId, attachment.role, attachment.score, 1, attachment.parentGroupId, [
        'owned by local subexpression',
        `family=${getRoleDescriptor(attachment.role).family}`,
        `peers=${getRoleDescriptor(attachment.role).peerRoles.join(',') || 'none'}`,
      ], containerIdsByGroupId.get(attachment.childGroupId) || []))
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

    const fractionWideFallbackCandidates = Array.from(roles.values())
      .filter((role) => role.role === 'numerator' || role.role === 'denominator')
      .flatMap((role) => {
        const parentGroup = groupMap.get(role.groupId)
        if (!parentGroup || !isFractionWideOutsideMember(group.id, role, groupMap)) return []
        return (['superscript', 'subscript'] as const)
          .map((scriptRole) => {
            const localityScore = getScriptLocalityScoreByKind(scriptRole, parentGroup, group)
            if (localityScore < 0.42) return null
            return makeCandidate(scriptRole, 0.34 + localityScore * 0.24, role.groupId, [
              'fraction-wide geometry fallback',
              `locality=${localityScore.toFixed(2)}`,
              `fallback-role=${scriptRole}`,
            ])
          })
          .filter(Boolean) as StructuralRoleCandidate[]
      })
      .filter(Boolean)
      .sort((left, right) => (right?.score || 0) - (left?.score || 0))[0] || null

    if (fractionWideFallbackCandidates) {
      candidates.push(fractionWideFallbackCandidates)
    }

    const best = chooseBestCandidate(candidates)
    const sortedCandidates = [...candidates].sort((left, right) => right.score - left.score)
    const runnerUp = sortedCandidates[1]

    let resolvedParentGroupId = best.parentGroupId || null
    const parentEnclosure = resolvedParentGroupId ? enclosureByBoundaryId.get(resolvedParentGroupId) || null : null
    if ((best.role === 'superscript' || best.role === 'subscript') && resolvedParentGroupId && parentEnclosure) {
      const redirectedParentId = getEnclosureSemanticRootId(parentEnclosure, resolvedParentGroupId, groupMap)
      if (redirectedParentId) {
        resolvedParentGroupId = redirectedParentId
      }
    }

    const parentRole = resolvedParentGroupId ? roles.get(resolvedParentGroupId) : null
    const assumedOperandRole = parentRole?.role || 'baseline'
    const parentSupportsAttachment = Boolean(resolvedParentGroupId)
      && !fractionBarIds.has(resolvedParentGroupId)
      && (!roleRequiresOperandReference(best.role) || roleUsesParentOperand(best.role))
      && roleAllowsOperandRole(best.role, assumedOperandRole)
      && (!parentRole || (roleCanOwnScripts(parentRole.role) && roleAllowsChildRole(parentRole.role, best.role)))

    const promotableFractionWideCandidate = sortedCandidates.find((candidate) => {
      if ((candidate.role !== 'superscript' && candidate.role !== 'subscript') || !candidate.parentGroupId) return false
      const candidateParentRole = roles.get(candidate.parentGroupId) || null
      return isFractionWideOutsideMember(group.id, candidateParentRole, groupMap)
    }) || null

    const selectedScriptCandidate = (() => {
      if ((best.role === 'superscript' || best.role === 'subscript') && resolvedParentGroupId && parentSupportsAttachment) {
        const minimumScore = isFractionWideOutsideMember(group.id, parentRole || null, groupMap) ? 0.32 : 0.45
        if (best.score >= minimumScore) {
          return { candidate: best, parentGroupId: resolvedParentGroupId, parentRole, fractionWidePromotion: minimumScore < 0.45 }
        }
      }

      if (!promotableFractionWideCandidate?.parentGroupId) return null
      const promotedParentRole = roles.get(promotableFractionWideCandidate.parentGroupId) || null
      const promotedParentSupportsAttachment = (!roleRequiresOperandReference(promotableFractionWideCandidate.role) || roleUsesParentOperand(promotableFractionWideCandidate.role))
        && roleAllowsOperandRole(promotableFractionWideCandidate.role, promotedParentRole?.role || 'baseline')
        && (!promotedParentRole || (roleCanOwnScripts(promotedParentRole.role) && roleAllowsChildRole(promotedParentRole.role, promotableFractionWideCandidate.role)))
      if (!promotedParentSupportsAttachment) return null
      if (promotableFractionWideCandidate.score < 0.32) return null
      if ((sortedCandidates[0]?.score || 0) - promotableFractionWideCandidate.score > 0.18) return null

      return {
        candidate: promotableFractionWideCandidate,
        parentGroupId: promotableFractionWideCandidate.parentGroupId,
        parentRole: promotedParentRole,
        fractionWidePromotion: true,
      }
    })()

    if (selectedScriptCandidate) {
      const nextRole = makeRole(group.id, selectedScriptCandidate.candidate.role, selectedScriptCandidate.candidate.score, 1, selectedScriptCandidate.parentGroupId, [
        ...(selectedScriptCandidate.candidate.evidence || []),
        `parent-family=${selectedScriptCandidate.parentRole ? selectedScriptCandidate.parentRole.descriptor.family : 'expressionRoot'}`,
        `operator-kind=${getRoleDescriptor(selectedScriptCandidate.candidate.role).operatorKind}`,
        `operand-mode=${getRoleDescriptor(selectedScriptCandidate.candidate.role).operandReferenceMode}`,
        `operand-allows=${String(roleAllowsOperandRole(selectedScriptCandidate.candidate.role, selectedScriptCandidate.parentRole?.role || 'baseline'))}`,
        `redirected-parent=${selectedScriptCandidate.candidate.parentGroupId && selectedScriptCandidate.candidate.parentGroupId !== selectedScriptCandidate.parentGroupId ? `${selectedScriptCandidate.candidate.parentGroupId}->${selectedScriptCandidate.parentGroupId}` : 'none'}`,
        `parent-allows=${selectedScriptCandidate.parentRole ? String(roleAllowsChildRole(selectedScriptCandidate.parentRole.role, selectedScriptCandidate.candidate.role)) : 'true'}`,
        `fraction-wide-promotion=${selectedScriptCandidate.fractionWidePromotion ? 'true' : 'false'}`,
        `ancestry=${getRoleDescriptor(selectedScriptCandidate.candidate.role).ancestry.join('>')}`,
      ], containerIdsByGroupId.get(group.id) || [])
      roles.set(group.id, nextRole)
      if (selectedScriptCandidate.fractionWidePromotion || isFractionWideOutsideMember(group.id, selectedScriptCandidate.parentRole || null, groupMap)) {
        const baselineAlternative = sortedCandidates.find((candidate) => candidate.role === 'baseline') || null
        if (baselineAlternative) {
          ambiguities.push({
            groupId: group.id,
            reason: 'fraction-wide-script-vs-baseline',
            chosenRole: selectedScriptCandidate.candidate.role,
            candidates: [selectedScriptCandidate.candidate, baselineAlternative],
          })
        }
      }
      if ((bestSequence && bestSequence.score >= 0.16 && Math.abs(selectedScriptCandidate.candidate.score - bestSequence.score) <= 0.3) || (runnerUp && Math.abs(selectedScriptCandidate.candidate.score - runnerUp.score) <= 0.14)) {
        ambiguities.push({
          groupId: group.id,
          reason: bestSequence && bestSequence.score >= 0.16 && Math.abs(selectedScriptCandidate.candidate.score - bestSequence.score) <= 0.3 ? 'sequence-vs-script' : 'competing-relations',
          chosenRole: selectedScriptCandidate.candidate.role,
          candidates: sortedCandidates.slice(0, 3),
        })
      }
      continue
    }

    roles.set(group.id, makeRole(group.id, 'baseline', sortedCandidates[0]?.score || 0.34, 0, null, [
      'defaulted to baseline after candidate comparison',
      `family=${getRoleDescriptor('baseline').family}`,
    ], containerIdsByGroupId.get(group.id) || []))

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

  const resolvedRoles = groups
    .map((group) => {
      const existing = roles.get(group.id)
      if (existing) return existing
      if (fractionBarIds.has(group.id)) {
        return makeRole(group.id, 'unsupportedSymbol', 0.58, 0, null, [
          'line-like group did not satisfy supported fraction structure requirements',
          'preserved instead of defaulting to baseline',
          `family=${getRoleDescriptor('unsupportedSymbol').family}`,
        ], containerIdsByGroupId.get(group.id) || [])
      }
      return makeRole(group.id, 'baseline', 0.5, 0, null, ['fallback default'], containerIdsByGroupId.get(group.id) || [])
    })
    .sort((left, right) => left.depth - right.depth)
  const { roles: operandSafeRoles, flags: operandFlags } = demoteMissingOperandScripts(resolvedRoles)
  const { roles: admissibleRoles, flags } = resolveStructuralAdmissibility(groups, operandSafeRoles, edges)
  const contexts = buildExpressionContexts(groups, admissibleRoles, subexpressions, enclosures, fractionBindings)
  const annotatedRoles = annotateRolesWithContexts(admissibleRoles, contexts, groups)
  const annotatedRoleMap = new Map(annotatedRoles.map((role) => [role.groupId, role]))
  const contextualizedRoles = annotatedRoles.map((role) => ({
    ...role,
    depth: role.parentGroupId ? roleDepth(annotatedRoleMap, role.groupId) : 0,
  }))
  const identityAwareRoles = annotateRolesWithRecognizedSymbols(contextualizedRoles, groups)
  const fractionAwareAmbiguities = appendFractionWideScriptAmbiguities(identityAwareRoles, groups, contexts, ambiguities)
  const contextualizedAmbiguities = appendEnclosureWideScriptAmbiguities(identityAwareRoles, contexts, fractionAwareAmbiguities)

  return {
    roles: identityAwareRoles,
    flags: [...operandFlags, ...flags],
    subexpressions,
    enclosures,
    contexts,
    ambiguities: contextualizedAmbiguities,
  }
}