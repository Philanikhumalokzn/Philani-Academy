import { getUserKey, normalizeDisplayName } from './presenterControl'

export type SwitchingPresenceClient = {
  clientId: string
  name?: string
  userId?: string
  canOrchestrateLesson?: boolean
}

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
  lastPresenterSetTs: number
  nowTs?: number
}

export type EvaluateSwitchingAuthoritiesResult = {
  activeCandidates: SwitchingAuthorityCandidate[]
  activeUserKeys: string[]
  canonicalCandidate: SwitchingAuthorityCandidate | null
  unresolvedReason: string
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
  const declaredPresenterClientIds = Array.from(args.activePresenterClientIds).filter(Boolean)

  if (activePresenterKey) {
    const identity = resolveIdentityForUserKey(activePresenterKey)
    const presenterGrantTs = Number.isFinite(args.lastPresenterSetTs) ? Number(args.lastPresenterSetTs) : 0
    const matchingClientIds = new Set<string>((identity?.clientIds || []).filter(Boolean))

    for (const clientId of declaredPresenterClientIds) {
      const resolved = resolveUserForClientId(clientId)
      if (!resolved || resolved.userKey === activePresenterKey) {
        matchingClientIds.add(clientId)
        continue
      }

      addCandidate({
        userKey: resolved.userKey,
        name: resolved.name,
        clientId,
        reason: 'presenter-client-mismatch',
        grantTs: presenterGrantTs,
      })
    }

    addCandidate({
      userKey: activePresenterKey,
      name: identity?.name || activePresenterKey,
      reason: 'presenter',
      grantTs: presenterGrantTs,
    })
    for (const clientId of Array.from(matchingClientIds)) {
      addCandidate({
        userKey: activePresenterKey,
        name: identity?.name || activePresenterKey,
        clientId,
        reason: 'presenter-client',
        grantTs: presenterGrantTs,
      })
    }
  } else if (declaredPresenterClientIds.length) {
    for (const clientId of declaredPresenterClientIds) {
      const resolved = resolveUserForClientId(clientId)
      addCandidate({
        userKey: resolved?.userKey || `client:${clientId}`,
        name: resolved?.name || clientId,
        clientId,
        reason: 'presenter-client-without-user',
        grantTs: Number.isFinite(args.lastPresenterSetTs) ? Number(args.lastPresenterSetTs) : 0,
      })
    }
  }

  const activeCandidates = Array.from(candidates.values())
  const activeUserKeys = activeCandidates.map(candidate => candidate.userKey)

  const grants = activeCandidates
    .map(candidate => ({ grantTs: candidate.grantTs, candidate }))
    .filter(item => item.grantTs > 0)
    .sort((a, b) => b.grantTs - a.grantTs)

  let canonicalCandidate: SwitchingAuthorityCandidate | null = null
  let unresolvedReason = ''
  if (activeCandidates.length === 1) {
    canonicalCandidate = activeCandidates[0]
  } else if (activeCandidates.length > 1) {
    if (activePresenterKey) {
      canonicalCandidate = activeCandidates.find(candidate => candidate.userKey === activePresenterKey) || null
      unresolvedReason = 'Presenter client ids resolve to multiple user identities.'
    } else if (!grants.length) {
      unresolvedReason = 'Presenter client ids exist without a canonical presenter user key.'
    } else {
      const topGrantTs = grants[0].grantTs
      const top = grants.filter(item => item.grantTs === topGrantTs)
      if (top.length === 1) {
        canonicalCandidate = top[0].candidate
      }
      unresolvedReason = 'Presenter client ids resolve to multiple user identities.'
    }
  }

  return {
    activeCandidates,
    activeUserKeys,
    canonicalCandidate,
    unresolvedReason,
  }
}
