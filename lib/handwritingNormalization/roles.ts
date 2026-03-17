import type { LayoutEdge, StrokeGroup, StructuralAmbiguity, StructuralRole, StructuralRoleCandidate } from './types'

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

export const inferStructuralRoles = (groups: StrokeGroup[], edges: LayoutEdge[]) => {
  const roles = new Map<string, StructuralRole>()
  const ambiguities: StructuralAmbiguity[] = []
  const fractionBars = groups.filter(isFractionBarGroup)

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
    const numerators = groups
      .filter((group) => group.id !== bar.id && group.bounds.bottom <= bar.bounds.top + 16)
      .filter((group) => !(group.bounds.right < bar.bounds.left || group.bounds.left > bar.bounds.right))
      .sort((left, right) => left.bounds.left - right.bounds.left)

    for (const numerator of numerators) {
      const candidates: StructuralRoleCandidate[] = [
        { role: 'numerator', score: 0.82, parentGroupId: bar.id },
        { role: 'baseline', score: 0.36, parentGroupId: null },
      ]
      roles.set(numerator.id, {
        groupId: numerator.id,
        role: 'numerator',
        score: 0.82,
        depth: 1,
        parentGroupId: bar.id,
      })
      ambiguities.push({
        groupId: numerator.id,
        reason: 'fraction-membership',
        chosenRole: 'numerator',
        candidates,
      })
    }

    const denominators = groups
      .filter((group) => group.id !== bar.id && group.bounds.top >= bar.bounds.bottom - 12)
      .filter((group) => !(group.bounds.right < bar.bounds.left || group.bounds.left > bar.bounds.right))
      .sort((left, right) => left.bounds.left - right.bounds.left)

    for (const denominator of denominators) {
      const candidates: StructuralRoleCandidate[] = [
        { role: 'denominator', score: 0.82, parentGroupId: bar.id },
        { role: 'baseline', score: 0.35, parentGroupId: null },
      ]
      roles.set(denominator.id, {
        groupId: denominator.id,
        role: 'denominator',
        score: 0.82,
        depth: 1,
        parentGroupId: bar.id,
      })
      ambiguities.push({
        groupId: denominator.id,
        reason: 'fraction-membership',
        chosenRole: 'denominator',
        candidates,
      })
    }
  }

  const remaining = groups.filter((group) => !roles.has(group.id))
  for (const group of remaining) {
    const superCandidates = incomingByKind(edges, group.id, 'superscriptCandidate')
    const subCandidates = incomingByKind(edges, group.id, 'subscriptCandidate')
    const sequenceCandidates = incomingByKind(edges, group.id, 'sequence')
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
      if (!roles.has(best.parentGroupId)) {
        roles.set(best.parentGroupId, {
          groupId: best.parentGroupId,
          role: 'baseline',
          score: 0.72,
          depth: 0,
          parentGroupId: null,
        })
      }

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
    ambiguities,
  }
}