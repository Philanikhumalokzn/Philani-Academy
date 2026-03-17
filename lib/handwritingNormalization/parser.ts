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
  const nodeIdByGroupId = new Map<string, string>()
  const nodeIdsByContextId = new Map<string, string[]>()

  const addNode = (node: ExpressionParseNode) => {
    nodes.push(node)
    const existing = nodeIdsByContextId.get(node.contextId) || []
    nodeIdsByContextId.set(node.contextId, [...existing, node.id])
    return node
  }

  const getNodeLeft = (nodeId: string) => {
    const node = nodes.find((entry) => entry.id === nodeId)
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
    const contextId = role?.associationContextId || getContainerContextId(contexts, role?.containerGroupIds || [])
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

  const enclosureNodeIdByContextId = new Map<string, string>()
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

    addNode({
      id: `parse:script:${scriptRole.groupId}`,
      kind: 'scriptApplication',
      contextId: scriptRole.containerGroupIds.length ? getContainerContextId(contexts, scriptRole.containerGroupIds) : 'context:root',
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

    return {
      contextId: context.id,
      nodeIds: [rootNode.id],
      rootNodeId: rootNode.id,
    }
  })

  return { parseNodes: nodes, parseRoots }
}