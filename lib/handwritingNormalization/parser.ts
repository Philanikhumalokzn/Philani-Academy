import type { ContextParseRoot, EnclosureStructure, ExpressionContext, ExpressionParseAlternative, ExpressionParseNode, StrokeGroup, StructuralAmbiguity, StructuralRole, StructuralRoleCandidate } from './types'

const uniqueIds = (values: string[]) => Array.from(new Set(values.filter(Boolean)))

const getContextPriority = (context: ExpressionContext) => {
  switch (context.kind) {
    case 'enclosure':
      return 0
    case 'numerator':
    case 'denominator':
      return 1
    case 'fraction':
      return 2
    case 'root':
    default:
      return 3
  }
}

const getContainerContextId = (contexts: ExpressionContext[], containerGroupIds: string[]) => {
  if (!containerGroupIds.length) return 'context:root'
  return contexts.find((context) => context.kind === 'enclosure' && containerGroupIds.every((groupId) => context.anchorGroupIds.includes(groupId)))?.id || 'context:root'
}

export const buildExpressionParseForest = (
  groups: StrokeGroup[],
  roles: StructuralRole[],
  contexts: ExpressionContext[],
  enclosures: EnclosureStructure[],
  ambiguities: StructuralAmbiguity[],
) => {
  const nodes: ExpressionParseNode[] = []
  const roleMap = new Map(roles.map((role) => [role.groupId, role]))
  const contextMap = new Map(contexts.map((context) => [context.id, context]))
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const nodeMap = new Map<string, ExpressionParseNode>()
  const nodeIdByGroupId = new Map<string, string>()
  const nodeIdsByContextId = new Map<string, string[]>()
  const sequenceRootNodeIdByContextId = new Map<string, string>()
  const enclosureNodeIdByContextId = new Map<string, string>()
  const fractionNodeIdByExpressionContextId = new Map<string, string>()
  const enclosureNodeMetaById = new Map<string, { expressionContextId: string }>()
  const fractionNodeMetaById = new Map<string, { expressionContextId?: string | null, numeratorGroupId?: string | null, denominatorGroupId?: string | null }>()
  const parseScopedAmbiguities = ambiguities.filter((ambiguity) => ambiguity.reason === 'fraction-wide-script-vs-baseline' || ambiguity.reason === 'enclosure-wide-script-vs-baseline')
  const parseScopedAmbiguityGroupIds = new Set(parseScopedAmbiguities.map((ambiguity) => ambiguity.groupId))

  const getFallbackContextIdForRole = (role: Pick<StructuralRole, 'associationContextId' | 'containerGroupIds'>) => {
    if (role.associationContextId) return role.associationContextId
    return getContainerContextId(contexts, role.containerGroupIds)
  }

  const getScriptNodeId = (scriptRole: StructuralRole, fallbackParentGroupId?: string | null, nodeId = `parse:script:${scriptRole.groupId}`) => {
    if (nodeMap.has(nodeId)) return nodeId

    const operandNodeId = buildScriptOperandNodeId(scriptRole, fallbackParentGroupId)
    if (!operandNodeId) return null

    const parentGroupId = fallbackParentGroupId || scriptRole.parentGroupId
    const fallbackContextId = scriptRole.containerGroupIds.length
      ? getContainerContextId(contexts, scriptRole.containerGroupIds)
      : getFallbackContextIdForRole(scriptRole)
    const contextId = getMostLocalContextId(uniqueIds([scriptRole.groupId, ...(parentGroupId ? [parentGroupId] : [])]), fallbackContextId)

    addNode({
      id: nodeId,
      kind: 'scriptApplication',
      contextId,
      groupIds: uniqueIds([scriptRole.groupId, ...(parentGroupId ? [parentGroupId] : [])]),
      childNodeIds: [operandNodeId],
      operatorGroupId: scriptRole.groupId,
      role: scriptRole.role,
      label: `${scriptRole.role}:${scriptRole.groupId}`,
    })

    return nodeId
  }

  const getCandidateGroupNodeId = (groupId: string, candidate: StructuralRoleCandidate, branchKey: string) => {
    const contextId = candidate.associationContextId || getMostLocalContextId([groupId], 'context:root')
    const nodeId = `parse:group:${groupId}:${branchKey}`
    if (nodeMap.has(nodeId)) return nodeId

    addNode({
      id: nodeId,
      kind: 'group',
      contextId,
      groupIds: [groupId],
      childNodeIds: [],
      role: candidate.role,
      label: `${candidate.role}:${groupId}:${branchKey}`,
    })

    return nodeId
  }

  const buildCandidateParseAlternative = (
    ambiguity: StructuralAmbiguity,
    candidate: StructuralAmbiguity['candidates'][number],
    rank: number,
  ): ExpressionParseAlternative | null => {
    const resolvedRole = roleMap.get(ambiguity.groupId)
    if (!resolvedRole) return null
    const candidateRole: StructuralRole = {
      ...resolvedRole,
      role: candidate.role,
      score: candidate.score,
      parentGroupId: candidate.parentGroupId ?? null,
      associationContextId: candidate.associationContextId ?? null,
      containerGroupIds: candidate.containerGroupIds || [],
      normalizationAnchorGroupIds: candidate.normalizationAnchorGroupIds || [],
      evidence: candidate.evidence || resolvedRole.evidence,
    }

    const isChosenCandidate = candidate.role === ambiguity.chosenRole
      && (candidate.parentGroupId ?? null) === (resolvedRole.parentGroupId ?? null)
      && (candidate.associationContextId ?? resolvedRole.associationContextId ?? null) === (resolvedRole.associationContextId ?? null)

    const branchKey = `ambiguity:${ambiguity.reason}:${rank}:${candidate.role}:${candidate.parentGroupId || 'root'}:${candidate.associationContextId || 'context:root'}`

    let nodeId: string | null = null
    let nodeKind: ExpressionParseAlternative['nodeKind'] = 'group'
    if (candidate.role === 'superscript' || candidate.role === 'subscript') {
      nodeKind = 'scriptApplication'
      nodeId = getScriptNodeId(candidateRole, candidate.parentGroupId, `parse:script:${ambiguity.groupId}:${branchKey}`)
    } else {
      nodeId = getCandidateGroupNodeId(ambiguity.groupId, candidate, branchKey)
    }
    if (!nodeId) return null

    return {
      nodeId,
      nodeKind,
      role: candidate.role,
      rank,
      score: candidate.score,
      parentGroupId: candidate.parentGroupId ?? null,
      contextId: candidateRole.associationContextId || null,
      relation: isChosenCandidate ? 'chosen' : 'alternative',
      label: `${candidate.role}:${ambiguity.groupId}`,
    }
  }

  const buildScriptOperandNodeId = (scriptRole: StructuralRole, fallbackParentGroupId?: string | null) => {
    if (scriptRole.associationContextId && enclosureNodeIdByContextId.has(scriptRole.associationContextId) && scriptRole.containerGroupIds.length === 0) {
      return enclosureNodeIdByContextId.get(scriptRole.associationContextId) || null
    }
    if (scriptRole.associationContextId && fractionNodeIdByExpressionContextId.has(scriptRole.associationContextId)) {
      return fractionNodeIdByExpressionContextId.get(scriptRole.associationContextId) || null
    }
    const parentGroupId = fallbackParentGroupId || scriptRole.parentGroupId
    if (!parentGroupId) return null
    const parentEnclosure = enclosures.find((enclosure) => enclosure.openGroupId === parentGroupId || enclosure.closeGroupId === parentGroupId) || null
    if (parentEnclosure) {
      const parentEnclosureContextId = `context:enclosure:${parentEnclosure.openGroupId}:${parentEnclosure.closeGroupId}`
      if (enclosureNodeIdByContextId.has(parentEnclosureContextId)) {
        return enclosureNodeIdByContextId.get(parentEnclosureContextId) || null
      }
    }
    return getOrCreateGroupNode(parentGroupId)
  }

  const getMostLocalContextId = (groupIds: string[], fallbackContextId: string) => {
    const candidateIds = uniqueIds(groupIds)
    const matchingContexts = contexts
      .filter((context) => candidateIds.every((groupId) => context.memberGroupIds.includes(groupId)))
      .sort((left, right) => {
        const priorityDelta = getContextPriority(left) - getContextPriority(right)
        if (priorityDelta !== 0) return priorityDelta
        const sizeDelta = left.memberGroupIds.length - right.memberGroupIds.length
        if (sizeDelta !== 0) return sizeDelta
        const anchorDelta = left.anchorGroupIds.length - right.anchorGroupIds.length
        if (anchorDelta !== 0) return anchorDelta
        return left.id.localeCompare(right.id)
      })
    return matchingContexts[0]?.id || fallbackContextId
  }

  const addNode = (node: ExpressionParseNode) => {
    nodes.push(node)
    nodeMap.set(node.id, node)
    const existing = nodeIdsByContextId.get(node.contextId) || []
    nodeIdsByContextId.set(node.contextId, [...existing, node.id])
    return node
  }

  const getNodeLeft = (nodeId: string) => {
    const node = nodeMap.get(nodeId)
    if (!node) return Number.POSITIVE_INFINITY
    const lefts = node.groupIds
      .map((groupId) => groupMap.get(groupId)?.bounds.left)
      .filter((value): value is number => typeof value === 'number')
    return lefts.length ? Math.min(...lefts) : Number.POSITIVE_INFINITY
  }

  const getOrCreateGroupNode = (groupId: string) => {
    const existingId = nodeIdByGroupId.get(groupId)
    if (existingId) return existingId
    const role = roleMap.get(groupId)
    const fallbackContextId = role?.associationContextId || getContainerContextId(contexts, role?.containerGroupIds || [])
    const contextId = getMostLocalContextId([groupId], fallbackContextId)
    const node = addNode({
      id: `parse:group:${groupId}`,
      kind: 'group',
      contextId,
      groupIds: [groupId],
      childNodeIds: [],
      role: role?.role || 'unsupportedSymbol',
      label: role ? `${role.role}:${groupId}` : `group:${groupId}`,
    })
    nodeIdByGroupId.set(groupId, node.id)
    return node.id
  }

  const getContextSemanticRootNodeId = (context: ExpressionContext) => {
    if (!context.semanticRootGroupId) return null

    if (context.kind === 'fraction' && fractionNodeIdByExpressionContextId.has(context.id)) {
      return fractionNodeIdByExpressionContextId.get(context.id) || null
    }

    const semanticRole = roleMap.get(context.semanticRootGroupId) || null
    const semanticEnclosureContextId = semanticRole?.containerGroupIds.length
      ? `context:enclosure:${semanticRole.containerGroupIds.join(':')}`
      : null
    if (semanticEnclosureContextId && enclosureNodeIdByContextId.has(semanticEnclosureContextId)) {
      return enclosureNodeIdByContextId.get(semanticEnclosureContextId) || null
    }

    return getOrCreateGroupNode(context.semanticRootGroupId)
  }

  for (const enclosure of enclosures) {
    const contextId = `context:enclosure:${enclosure.openGroupId}:${enclosure.closeGroupId}`
    const context = contextMap.get(contextId)
    const semanticRootGroupId = context?.semanticRootGroupId || enclosure.memberRootIds[0] || null
    const childNodeIds = semanticRootGroupId ? [getOrCreateGroupNode(semanticRootGroupId)] : []
    const node = addNode({
      id: `parse:enclosure:${enclosure.openGroupId}:${enclosure.closeGroupId}`,
      kind: 'enclosureExpression',
      contextId: context?.parentContextId || 'context:root',
      groupIds: uniqueIds([enclosure.openGroupId, enclosure.closeGroupId, ...(semanticRootGroupId ? [semanticRootGroupId] : [])]),
      childNodeIds,
      role: semanticRootGroupId ? roleMap.get(semanticRootGroupId)?.role : undefined,
      label: `enclosure:${semanticRootGroupId || 'unknown'}`,
    })
    enclosureNodeIdByContextId.set(contextId, node.id)
    enclosureNodeMetaById.set(node.id, { expressionContextId: contextId })
  }

  const fractionBarRoles = roles.filter((role) => role.role === 'fractionBar')
  for (const barRole of fractionBarRoles) {
    const numeratorRole = roles.find((role) => role.parentGroupId === barRole.groupId && role.role === 'numerator') || null
    const denominatorRole = roles.find((role) => role.parentGroupId === barRole.groupId && role.role === 'denominator') || null
    const expressionContextId = contextMap.has(`context:fraction:${barRole.groupId}`) ? `context:fraction:${barRole.groupId}` : null
    const childNodeIds = [numeratorRole?.groupId, denominatorRole?.groupId]
      .filter(Boolean)
      .map((groupId) => getOrCreateGroupNode(groupId as string))
    const node = addNode({
      id: `parse:fraction:${barRole.groupId}`,
      kind: 'fractionExpression',
      contextId: barRole.associationContextId || 'context:root',
      groupIds: uniqueIds([barRole.groupId, ...(numeratorRole ? [numeratorRole.groupId] : []), ...(denominatorRole ? [denominatorRole.groupId] : [])]),
      childNodeIds,
      operatorGroupId: barRole.groupId,
      role: 'fractionBar',
      label: `fraction:${barRole.groupId}`,
    })
    if (expressionContextId) {
      fractionNodeIdByExpressionContextId.set(expressionContextId, node.id)
    }
    fractionNodeMetaById.set(node.id, {
      expressionContextId,
      numeratorGroupId: numeratorRole?.groupId || null,
      denominatorGroupId: denominatorRole?.groupId || null,
    })
  }

  const scriptRoles = roles.filter((role) => role.role === 'superscript' || role.role === 'subscript')
  for (const scriptRole of scriptRoles) {
    if (parseScopedAmbiguityGroupIds.has(scriptRole.groupId)) continue
    getScriptNodeId(scriptRole)
  }

  const ambiguityNodes = parseScopedAmbiguities
  for (const ambiguity of ambiguityNodes) {
    const chosenRole = roleMap.get(ambiguity.groupId)
    if (!chosenRole) continue
    const candidates = [...ambiguity.candidates]
      .sort((left, right) => right.score - left.score || left.role.localeCompare(right.role))
    const alternatives = candidates
      .map((candidate, index) => buildCandidateParseAlternative(ambiguity, candidate, index + 1))
      .filter((candidate): candidate is ExpressionParseAlternative => Boolean(candidate))
    const chosenAlternative = alternatives.find((candidate) => candidate.relation === 'chosen') || null
    const preferredChildNodeId = chosenAlternative?.nodeId || null
    const contextId = chosenAlternative?.contextId || chosenRole.associationContextId || getMostLocalContextId([ambiguity.groupId], 'context:root')

    if (!alternatives.length) continue

    addNode({
      id: `parse:ambiguity:${ambiguity.groupId}`,
      kind: 'ambiguityExpression',
      contextId,
      groupIds: uniqueIds([ambiguity.groupId]),
      childNodeIds: uniqueIds(alternatives.map((candidate) => candidate.nodeId)),
      role: chosenRole.role,
      ambiguityReason: ambiguity.reason,
      preferredChildNodeId,
      alternatives,
      label: `ambiguity:${ambiguity.groupId}`,
    })
  }

  for (const role of roles) {
    if (role.role === 'fractionBar' || role.role === 'enclosureOpen' || role.role === 'enclosureClose' || role.role === 'superscript' || role.role === 'subscript') continue
    getOrCreateGroupNode(role.groupId)
  }

  const refreshSequenceRootNode = (contextId: string) => {
    const rootNodeId = sequenceRootNodeIdByContextId.get(contextId)
    if (!rootNodeId) return
    const rootNode = nodeMap.get(rootNodeId)
    if (!rootNode) return
    rootNode.groupIds = uniqueIds(rootNode.childNodeIds.flatMap((nodeId) => nodeMap.get(nodeId)?.groupIds || []))
  }

  const parseRoots: ContextParseRoot[] = contexts.map((context) => {
    const contextNodeIds = uniqueIds(nodeIdsByContextId.get(context.id) || [])
    const referencedChildIds = new Set(
      nodes
        .filter((node) => node.contextId === context.id)
        .flatMap((node) => node.childNodeIds)
    )
    const topLevelNodeIds = contextNodeIds
      .filter((nodeId) => !referencedChildIds.has(nodeId))
      .sort((left, right) => getNodeLeft(left) - getNodeLeft(right))

    if (!topLevelNodeIds.length) {
      const semanticRootNodeId = getContextSemanticRootNodeId(context)
      if (!semanticRootNodeId) {
        return {
          contextId: context.id,
          nodeIds: contextNodeIds,
          rootNodeId: null,
        }
      }
      topLevelNodeIds.push(semanticRootNodeId)
    }

    const rootNode = addNode({
      id: `parse:sequence:${context.id}`,
      kind: 'sequenceExpression',
      contextId: context.id,
      groupIds: uniqueIds(topLevelNodeIds.flatMap((nodeId) => nodes.find((entry) => entry.id === nodeId)?.groupIds || [])),
      childNodeIds: topLevelNodeIds,
      label: `sequence:${context.id}`,
    })
    sequenceRootNodeIdByContextId.set(context.id, rootNode.id)

    return {
      contextId: context.id,
      nodeIds: [rootNode.id],
      rootNodeId: rootNode.id,
    }
  })

  for (const [nodeId, meta] of enclosureNodeMetaById.entries()) {
    const contextRootNodeId = sequenceRootNodeIdByContextId.get(meta.expressionContextId)
    if (!contextRootNodeId) continue
    const node = nodeMap.get(nodeId)
    const contextRootNode = nodeMap.get(contextRootNodeId)
    if (!node || !contextRootNode) continue
    node.childNodeIds = [contextRootNodeId]
    node.groupIds = uniqueIds([...node.groupIds, ...contextRootNode.groupIds])
    refreshSequenceRootNode(node.contextId)
  }

  for (const [nodeId, meta] of fractionNodeMetaById.entries()) {
    const node = nodeMap.get(nodeId)
    if (!node) continue
    const numeratorRootNodeId = meta.numeratorGroupId ? sequenceRootNodeIdByContextId.get(`context:numerator:${meta.numeratorGroupId}`) : null
    const denominatorRootNodeId = meta.denominatorGroupId ? sequenceRootNodeIdByContextId.get(`context:denominator:${meta.denominatorGroupId}`) : null
    const childNodeIds = [
      numeratorRootNodeId || (meta.numeratorGroupId ? getOrCreateGroupNode(meta.numeratorGroupId) : null),
      denominatorRootNodeId || (meta.denominatorGroupId ? getOrCreateGroupNode(meta.denominatorGroupId) : null),
    ].filter(Boolean) as string[]
    node.childNodeIds = childNodeIds
    node.groupIds = uniqueIds([node.operatorGroupId || '', ...childNodeIds.flatMap((childNodeId) => nodeMap.get(childNodeId)?.groupIds || [])])
    refreshSequenceRootNode(node.contextId)
  }

  return { parseNodes: nodes, parseRoots }
}