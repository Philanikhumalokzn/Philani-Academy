export type PresenterPresenceClient = {
  clientId: string
  name?: string
  userId?: string
  isAdmin?: boolean
}

export type PresenterBadge = {
  clientId: string
  userKey: string
  name: string
  initials: string
}

export type PresenterAttendee = {
  clientId: string
  userId?: string
  userKey: string
  name: string
}

export type PresenterRosterAvatar = {
  kind: 'presenter' | 'attendee'
  userKey: string
  name: string
  initials: string
  clientId?: string
  userId?: string
}

export const normalizeDisplayName = (value: string) => String(value || '').trim().replace(/\s+/g, ' ')

export const getUserKey = (maybeUserId?: string, maybeName?: string) => {
  const uid = typeof maybeUserId === 'string' ? maybeUserId.trim() : ''
  if (uid) return `uid:${uid}`
  const nk = normalizeDisplayName(maybeName || '').toLowerCase()
  return nk ? `name:${nk}` : ''
}

export const getInitials = (name: string, fallback: string) => {
  const normalized = normalizeDisplayName(name)
  const parts = normalized.split(/\s+/).filter(Boolean)
  const a = parts[0]?.[0] || fallback
  const b = parts.length > 1 ? (parts[1]?.[0] || '') : (parts[0]?.[1] || '')
  return (a + b).toUpperCase()
}

export const resolveHandoffSelection = (params: {
  clickedClientId?: string
  clickedUserId?: string
  clickedUserKey?: string
  clickedDisplayName?: string
  connectedClients: PresenterPresenceClient[]
  excludedClientIds?: string[]
}) => {
  const clickedClientId = String(params.clickedClientId || '').trim()
  const clickedUserId = String(params.clickedUserId || '').trim()
  const clickedUserKey = String(params.clickedUserKey || '').trim()
  const clickedDisplayName = normalizeDisplayName(params.clickedDisplayName || '')
  const excluded = new Set((params.excludedClientIds || []).filter(Boolean))

  const nameKey = normalizeDisplayName(clickedDisplayName).toLowerCase()
  const matchingClientIds = params.connectedClients
    .filter(x => x.clientId && !excluded.has(x.clientId))
    .filter(x => {
      const xUserId = typeof x.userId === 'string' ? String(x.userId) : ''
      if (clickedUserId && xUserId) return xUserId === clickedUserId
      const xName = normalizeDisplayName(x.name || '') || String(x.clientId)
      return normalizeDisplayName(xName).toLowerCase() === nameKey
    })
    .map(x => x.clientId)

  const nextClientIds = matchingClientIds.length ? matchingClientIds : (clickedClientId ? [clickedClientId] : [])

  const resolvedPresenterKey = (() => {
    if (clickedUserKey) return clickedUserKey
    for (const c of params.connectedClients) {
      if (!c.clientId || !nextClientIds.includes(c.clientId)) continue
      const display = normalizeDisplayName(c.name || '') || String(c.clientId)
      const key = getUserKey(c.userId, display)
      if (key) return key
    }
    return ''
  })()

  const resolvedDisplayName = (() => {
    if (clickedDisplayName) return clickedDisplayName
    const found = params.connectedClients.find(c => c.clientId && nextClientIds.includes(c.clientId))
    const display = normalizeDisplayName(found?.name || '')
    return display || (nextClientIds[0] || '')
  })()

  return {
    nextClientIds,
    resolvedPresenterKey,
    resolvedDisplayName,
  }
}

export const deriveActivePresenterBadge = (params: {
  activePresenterUserKey?: string | null
  activePresenterClientIds: Set<string>
  connectedClients: PresenterPresenceClient[]
  fallbackName?: string
  fallbackInitial?: string
}) => {
  const activeKey = String(params.activePresenterUserKey || '').trim()
  const activeClientIds = params.activePresenterClientIds
  if (!activeKey && !activeClientIds.size) return null

  const candidates = params.connectedClients.filter(c => {
    if (!c.clientId || c.clientId === 'all') return false
    if (Boolean(c.isAdmin)) return false
    const key = getUserKey(c.userId, c.name || '')
    if (activeKey && key && key === activeKey) return true
    return activeClientIds.has(c.clientId)
  })

  const chosen = candidates[0] || null
  if (!chosen) {
    const fallbackName = params.fallbackName || (activeKey ? activeKey.replace(/^uid:|^name:/, '') : 'Presenter')
    return {
      clientId: '',
      userKey: activeKey || 'presenter',
      name: fallbackName,
      initials: getInitials(fallbackName, params.fallbackInitial || 'P'),
    }
  }

  const displayName = normalizeDisplayName(chosen.name || '') || String(chosen.clientId)
  return {
    clientId: chosen.clientId,
    userKey: getUserKey(chosen.userId, displayName) || activeKey || `name:${displayName.toLowerCase()}`,
    name: displayName,
    initials: getInitials(displayName, params.fallbackInitial || 'P'),
  }
}

export const deriveAvailableRosterAttendees = (params: {
  connectedClients: PresenterPresenceClient[]
  selfClientId?: string
  selfUserId?: string
  activePresenterUserKey?: string | null
  activePresenterClientIds: Set<string>
  excludedClientIds?: string[]
}) => {
  const selfClientId = String(params.selfClientId || '').trim()
  const selfUserId = String(params.selfUserId || '').trim()
  const activeKey = String(params.activePresenterUserKey || '').trim()
  const activeClientIds = params.activePresenterClientIds
  const excluded = new Set((params.excludedClientIds || []).filter(Boolean))

  const byUser = new Map<string, { clientId: string; userId?: string; name: string; userKey: string; hasUserId: boolean }>()

  for (const c of params.connectedClients) {
    if (!c.clientId || c.clientId === 'all' || excluded.has(c.clientId)) continue
    if (c.clientId === selfClientId) continue
    if (Boolean(c.isAdmin)) continue
    if (selfUserId && c.userId && String(c.userId) === selfUserId) continue

    const displayName = normalizeDisplayName(c.name || '') || String(c.clientId)
    const nameKey = normalizeDisplayName(displayName).toLowerCase()
    const personKey = c.userId ? `uid:${String(c.userId)}` : `name:${nameKey}`
    const userKey = getUserKey(c.userId, displayName) || `name:${nameKey}`
    if (!userKey) continue

    if ((activeKey && userKey === activeKey) || activeClientIds.has(c.clientId)) continue

    const existing = byUser.get(personKey)
    if (!existing) {
      byUser.set(personKey, {
        clientId: c.clientId,
        userId: c.userId,
        name: displayName,
        userKey,
        hasUserId: Boolean(c.userId),
      })
      continue
    }

    if (!existing.hasUserId && c.userId) {
      existing.clientId = c.clientId
      existing.userId = c.userId
      existing.userKey = userKey
      existing.hasUserId = true
    }
    if (!existing.name && displayName) {
      existing.name = displayName
    }
  }

  return Array.from(byUser.values()).map(x => ({
    clientId: x.clientId,
    userId: x.userId,
    userKey: x.userKey,
    name: x.name,
  }))
}

export const buildRosterAvatarLayout = (params: {
  activePresenterBadge: PresenterBadge | null
  availableAttendees: PresenterAttendee[]
  overlayRosterVisible: boolean
  attendeeInitialFallback?: string
}) => {
  const byUser = new Map<string, PresenterRosterAvatar>()

  if (params.activePresenterBadge) {
    byUser.set(params.activePresenterBadge.userKey, {
      kind: 'presenter',
      userKey: params.activePresenterBadge.userKey,
      name: params.activePresenterBadge.name,
      initials: params.activePresenterBadge.initials,
      clientId: params.activePresenterBadge.clientId,
    })
  }

  if (params.overlayRosterVisible) {
    for (const attendee of params.availableAttendees) {
      if (byUser.has(attendee.userKey)) continue
      byUser.set(attendee.userKey, {
        kind: 'attendee',
        userKey: attendee.userKey,
        name: attendee.name,
        initials: getInitials(attendee.name, params.attendeeInitialFallback || 'U'),
        clientId: attendee.clientId,
        userId: attendee.userId,
      })
    }
  }

  const all = Array.from(byUser.values()).sort((a, b) => a.name.localeCompare(b.name))
  const topCount = Math.floor(all.length / 2)
  return {
    top: all.slice(0, topCount),
    bottom: all.slice(topCount),
  }
}

export const waitForResolvedValue = async <T>(
  getValue: () => T | null | undefined,
  options?: { timeoutMs?: number; intervalMs?: number }
) => {
  const timeoutMs = Number.isFinite(options?.timeoutMs) ? Math.max(0, Number(options?.timeoutMs)) : 1000
  const intervalMs = Number.isFinite(options?.intervalMs) ? Math.max(10, Number(options?.intervalMs)) : 50

  const initial = getValue()
  if (initial != null) return initial

  const startTs = Date.now()
  while (Date.now() - startTs < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, intervalMs))
    const next = getValue()
    if (next != null) return next
  }

  const finalValue = getValue()
  return finalValue != null ? finalValue : null
}
