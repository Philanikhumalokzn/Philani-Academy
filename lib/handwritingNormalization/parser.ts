import type { ContextParseRoot, EnclosureStructure, ExpressionContext, ExpressionParseNode, StrokeGroup, StructuralRole } from './types'

const uniqueIds = (values: string[]) => Array.from(new Set(values.filter(Boolean)))

const getContainerContextId = (contexts: ExpressionContext[], containerGroupIds: string[]) => {
  if (!containerGroupIds.length) return 'context:root'
  return contexts.find((context) => context.kind === 'enclosure' && containerGroupIds.every((groupId) => context.anchorGroupIds.includes(groupId)))?.id || 'context:root'
}

export const buildExpressionParseForest = (
  groups: StrokeGroup[],
  roles: StructuralRole[],
  contexts: ExpressionContext[],
  enclosures: EnclosureStructure[],
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
  const enclosureNodeMetaById = new Map<string, { expressionContextId: string }>()
  const fractionNodeMetaById = new Map<string, { numeratorGroupId?: string | null, denominatorGroupId?: string | null }>()

  const getMostLocalContextId = (groupIds: string[], fallbackContextId: string) => {
    const candidateIds = uniqueIds(groupIds)
    const matchingContexts = contexts
      .filter((context) => candidateIds.every((groupId) => context.memberGroupIds.includes(groupId)))
      .sort((left, right) => {
        const leftRootBias = left.kind === 'root' ? 1 : 0
        const rightRootBias = right.kind === 'root' ? 1 : 0
        if (leftRootBias !== rightRootBias) return leftRootBias - rightRootBias
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
    const childNodeIds = [numeratorRole?.groupId, denominatorRole?.groupId]
      .filter(Boolean)
      .map((groupId) => getOrCreateGroupNode(groupId as string))
    addNode({
      id: `parse:fraction:${barRole.groupId}`,
      kind: 'fractionExpression',
      contextId: barRole.associationContextId || 'context:root',
      groupIds: uniqueIds([barRole.groupId, ...(numeratorRole ? [numeratorRole.groupId] : []), ...(denominatorRole ? [denominatorRole.groupId] : [])]),
      childNodeIds,
      operatorGroupId: barRole.groupId,
      role: 'fractionBar',
      label: `fraction:${barRole.groupId}`,
    })
    fractionNodeMetaById.set(`parse:fraction:${barRole.groupId}`, {
      numeratorGroupId: numeratorRole?.groupId || null,
      denominatorGroupId: denominatorRole?.groupId || null,
    })
  }

  const scriptRoles = roles.filter((role) => role.role === 'superscript' || role.role === 'subscript')
  for (const scriptRole of scriptRoles) {
    let operandNodeId: string | null = null
    if (scriptRole.associationContextId && enclosureNodeIdByContextId.has(scriptRole.associationContextId) && scriptRole.containerGroupIds.length === 0) {
      operandNodeId = enclosureNodeIdByContextId.get(scriptRole.associationContextId) || null
    }
    if (!operandNodeId && scriptRole.parentGroupId) {
      operandNodeId = getOrCreateGroupNode(scriptRole.parentGroupId)
    }
    if (!operandNodeId) continue

    const fallbackContextId = scriptRole.containerGroupIds.length ? getContainerContextId(contexts, scriptRole.containerGroupIds) : 'context:root'
    const contextId = getMostLocalContextId(uniqueIds([scriptRole.groupId, ...(scriptRole.parentGroupId ? [scriptRole.parentGroupId] : [])]), fallbackContextId)

    addNode({
      id: `parse:script:${scriptRole.groupId}`,
      kind: 'scriptApplication',
      contextId,
      groupIds: uniqueIds([scriptRole.groupId, ...(scriptRole.parentGroupId ? [scriptRole.parentGroupId] : [])]),
      childNodeIds: [operandNodeId],
      operatorGroupId: scriptRole.groupId,
      role: scriptRole.role,
      label: `${scriptRole.role}:${scriptRole.groupId}`,
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
      return {
        contextId: context.id,
        nodeIds: contextNodeIds,
        rootNodeId: null,
      }
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