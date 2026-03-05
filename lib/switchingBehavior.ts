import { getUserKey, normalizeDisplayName } from './presenterControl'

export type SwitchingPresenceClient = {
  clientId: string
  name?: string
  userId?: string
  isAdmin?: boolean
}

export type SwitchingControlLock = {
  controllerId: string
  controllerName?: string
  ts?: number
} | null

export type SwitchingAuthorityCandidate = {
  userKey: string
  name: string
  clientIds: Set<string>
  grantTs: number
  lastBroadcastTs: number
  reasons: Set<string>
}

export type EvaluateSwitchingAuthoritiesArgs = {
  connectedClients: SwitchingPresenceClient[]
  excludedClientIds?: string[]
  activePresenterUserKey?: string | null
  activePresenterClientIds: Set<string>
  controllerRightsUserAllowlist: Set<string>
  controllerRightsClientAllowlist: Set<string>
  rightsGrantedAtByUserKey: Map<string, number>
  recentBroadcastTsByUserKey: Map<string, number>
  lastPresenterSetTs: number
  lastControllerRightsTs: number
  controlLock?: SwitchingControlLock
  selfCanWrite: boolean
  selfUserKey: string
  selfClientId?: string
  selfDisplayName?: string
  nowTs?: number
  broadcastSignalWindowMs?: number
}

export type EvaluateSwitchingAuthoritiesResult = {
  activeCandidates: SwitchingAuthorityCandidate[]
  activeUserKeys: string[]
  canonicalCandidate: SwitchingAuthorityCandidate | null
  unresolvedReason: string
  staleBroadcastUserKeys: string[]
}

const buildResolvers = (clients: SwitchingPresenceClient[], excludedClientIds: string[]) => {
  const excluded = new Set(excludedClientIds.filter(Boolean))
  const visibleClients = clients.filter(client => {
    if (!client.clientId) return false
    if (excluded.has(client.clientId)) return false
    return true
  })

  const resolveUserForClientId = (candidateClientId?: string) => {
    const wanted = String(candidateClientId || '').trim()
    if (!wanted) return null
    const client = visibleClients.find(entry => entry.clientId === wanted)
    if (!client) return null
    const name = normalizeDisplayName(client.name || '') || client.clientId
    const userKey = getUserKey(client.userId, name) || `client:${client.clientId}`
    return {
      userKey,
      name,
      clientId: client.clientId,
      userId: client.userId,
    }
  }

  const resolveIdentityForUserKey = (candidateUserKey?: string) => {
    const userKey = String(candidateUserKey || '').trim()
    if (!userKey) return null
    const members = visibleClients.filter(client => {
      if (!client.clientId || client.clientId === 'all') return false
      const name = normalizeDisplayName(client.name || '') || client.clientId
      const key = getUserKey(client.userId, name) || `client:${client.clientId}`
      return key === userKey
    })
    const first = members[0] || null
    return {
      userKey,
      name: first ? (normalizeDisplayName(first.name || '') || first.clientId) : userKey.replace(/^uid:|^name:|^client:/, ''),
      userId: first?.userId,
      clientIds: members.map(member => member.clientId),
    }
  }

  return {
    resolveUserForClientId,
    resolveIdentityForUserKey,
  }
}

export const evaluateSwitchingAuthorities = (args: EvaluateSwitchingAuthoritiesArgs): EvaluateSwitchingAuthoritiesResult => {
  const now = Number.isFinite(args.nowTs) ? Number(args.nowTs) : Date.now()
  const broadcastSignalWindowMs = Number.isFinite(args.broadcastSignalWindowMs)
    ? Math.max(2000, Number(args.broadcastSignalWindowMs))
    : 12000

  const { resolveUserForClientId, resolveIdentityForUserKey } = buildResolvers(args.connectedClients, args.excludedClientIds || [])

  const candidates = new Map<string, SwitchingAuthorityCandidate>()
  const addCandidate = (params: {
    userKey?: string | null
    name?: string | null
    clientId?: string | null
    reason: string
    grantTs?: number
    broadcastTs?: number
  }) => {
    const key = String(params.userKey || '').trim()
    if (!key) return
    const existing = candidates.get(key) || {
      userKey: key,
      name: String(params.name || '').trim() || key,
      clientIds: new Set<string>(),
      grantTs: 0,
      lastBroadcastTs: 0,
      reasons: new Set<string>(),
    }
    if (params.clientId) {
      existing.clientIds.add(String(params.clientId))
    }
    if (params.name && !existing.name) {
      existing.name = String(params.name)
    }
    const grantTs = Number.isFinite(params.grantTs) ? Number(params.grantTs) : 0
    const broadcastTs = Number.isFinite(params.broadcastTs) ? Number(params.broadcastTs) : 0
    existing.grantTs = Math.max(existing.grantTs, grantTs)
    existing.lastBroadcastTs = Math.max(existing.lastBroadcastTs, broadcastTs)
    existing.reasons.add(params.reason)
    candidates.set(key, existing)
  }

  const activePresenterKey = String(args.activePresenterUserKey || '').trim()
  if (activePresenterKey) {
    const identity = resolveIdentityForUserKey(activePresenterKey)
    const presenterGrant = args.rightsGrantedAtByUserKey.get(activePresenterKey) ?? args.lastPresenterSetTs
    if (identity?.clientIds?.length) {
      for (const clientId of identity.clientIds) {
        addCandidate({
          userKey: activePresenterKey,
          name: identity.name,
          clientId,
          reason: 'presenter',
          grantTs: presenterGrant,
        })
      }
    } else {
      addCandidate({
        userKey: activePresenterKey,
        name: identity?.name || activePresenterKey,
        reason: 'presenter',
        grantTs: presenterGrant,
      })
    }

    for (const clientId of Array.from(args.activePresenterClientIds)) {
      const resolved = resolveUserForClientId(clientId)
      addCandidate({
        userKey: resolved?.userKey || activePresenterKey,
        name: resolved?.name || identity?.name || activePresenterKey,
        clientId,
        reason: 'presenter-client',
        grantTs: presenterGrant,
      })
    }
  }

  for (const userKey of Array.from(args.controllerRightsUserAllowlist)) {
    const identity = resolveIdentityForUserKey(userKey)
    const grantTs = args.rightsGrantedAtByUserKey.get(userKey) ?? args.lastControllerRightsTs
    addCandidate({
      userKey,
      name: identity?.name || userKey,
      reason: 'controller-rights-user',
      grantTs,
    })
    for (const clientId of identity?.clientIds || []) {
      addCandidate({
        userKey,
        name: identity?.name || userKey,
        clientId,
        reason: 'controller-rights-user-client',
        grantTs,
      })
    }
  }

  for (const clientId of Array.from(args.controllerRightsClientAllowlist)) {
    const resolved = resolveUserForClientId(clientId)
    if (!resolved) {
      addCandidate({
        userKey: `client:${clientId}`,
        name: clientId,
        clientId,
        reason: 'controller-rights-client',
        grantTs: args.lastControllerRightsTs,
      })
      continue
    }
    addCandidate({
      userKey: resolved.userKey,
      name: resolved.name,
      clientId,
      reason: 'controller-rights-client',
      grantTs: args.rightsGrantedAtByUserKey.get(resolved.userKey) ?? args.lastControllerRightsTs,
    })
  }

  const control = args.controlLock
  if (control && control.controllerId) {
    const resolved = resolveUserForClientId(control.controllerId)
    addCandidate({
      userKey: resolved?.userKey || `client:${control.controllerId}`,
      name: resolved?.name || control.controllerName || control.controllerId,
      clientId: control.controllerId,
      reason: 'control-lock',
      grantTs: Number(control.ts) || now,
    })
  }

  const staleBroadcastUserKeys: string[] = []
  args.recentBroadcastTsByUserKey.forEach((activityTs, userKey) => {
    if (!userKey) return
    if (now - activityTs > broadcastSignalWindowMs) {
      staleBroadcastUserKeys.push(userKey)
      return
    }

    const identity = resolveIdentityForUserKey(userKey)
    addCandidate({
      userKey,
      name: identity?.name || userKey,
      reason: 'recent-broadcast',
      broadcastTs: activityTs,
      grantTs: args.rightsGrantedAtByUserKey.get(userKey) ?? 0,
    })
    for (const clientId of identity?.clientIds || []) {
      addCandidate({
        userKey,
        name: identity?.name || userKey,
        clientId,
        reason: 'recent-broadcast-client',
        broadcastTs: activityTs,
        grantTs: args.rightsGrantedAtByUserKey.get(userKey) ?? 0,
      })
    }
  })

  if (args.selfCanWrite) {
    addCandidate({
      userKey: args.selfUserKey,
      name: normalizeDisplayName(args.selfDisplayName || '') || 'Teacher',
      clientId: args.selfClientId || undefined,
      reason: 'self-write-rights',
      grantTs: args.rightsGrantedAtByUserKey.get(args.selfUserKey) ?? now,
    })
  }

  const activeCandidates = Array.from(candidates.values())
  const activeUserKeys = activeCandidates.map(candidate => candidate.userKey)

  const grants = activeCandidates
    .map(candidate => ({ grantTs: candidate.grantTs, candidate }))
    .filter(item => item.grantTs > 0)
    .sort((a, b) => b.grantTs - a.grantTs)

  let canonicalCandidate: SwitchingAuthorityCandidate | null = null
  let unresolvedReason = ''
  if (activeCandidates.length > 1) {
    if (!grants.length) {
      unresolvedReason = 'No grant timestamps were available for conflicting editors.'
    } else {
      const topGrantTs = grants[0].grantTs
      const top = grants.filter(item => item.grantTs === topGrantTs)
      if (top.length !== 1) {
        unresolvedReason = 'Conflicting editors share the same grant timestamp.'
      } else {
        canonicalCandidate = top[0].candidate
      }
    }
  }

  return {
    activeCandidates,
    activeUserKeys,
    canonicalCandidate,
    unresolvedReason,
    staleBroadcastUserKeys,
  }
}
