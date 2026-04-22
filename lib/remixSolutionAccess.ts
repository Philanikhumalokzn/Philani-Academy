import prisma from './prisma'

export type RemixSolutionAccessState = 'requestable' | 'requested' | 'granted'

type AccessRow = {
  id: string
  response_id: string
  session_key: string
  owner_id: string
  viewer_id: string
  status: string
  request_notification_id: string | null
  grant_notification_id: string | null
  requested_at: Date | string | null
  granted_at: Date | string | null
  consumed_at: Date | string | null
  created_at: Date | string | null
  updated_at: Date | string | null
}

export type RemixSolutionAccessSnapshot = {
  requestId: string | null
  state: RemixSolutionAccessState
}

let ensureRemixSolutionAccessTablePromise: Promise<void> | null = null

const generateAccessId = () => `rsa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

const normalizeAccessRow = (row: AccessRow | null | undefined): RemixSolutionAccessSnapshot => {
  const status = String(row?.status || '').trim().toLowerCase()
  if (status === 'requested') {
    return { requestId: row?.id ? String(row.id) : null, state: 'requested' }
  }
  if (status === 'granted') {
    return { requestId: row?.id ? String(row.id) : null, state: 'granted' }
  }
  return { requestId: null, state: 'requestable' }
}

export const ensureRemixSolutionAccessTable = async () => {
  if (!ensureRemixSolutionAccessTablePromise) {
    ensureRemixSolutionAccessTablePromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS remix_solution_view_access (
          id TEXT PRIMARY KEY,
          session_key TEXT NOT NULL,
          response_id TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          viewer_id TEXT NOT NULL,
          status TEXT NOT NULL,
          request_notification_id TEXT,
          grant_notification_id TEXT,
          requested_at TIMESTAMPTZ,
          granted_at TIMESTAMPTZ,
          consumed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS remix_solution_view_access_response_viewer_idx ON remix_solution_view_access (response_id, viewer_id, created_at DESC)')
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS remix_solution_view_access_owner_status_idx ON remix_solution_view_access (owner_id, status, created_at DESC)')
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS remix_solution_view_access_viewer_status_idx ON remix_solution_view_access (viewer_id, status, created_at DESC)')
    })().catch((error) => {
      ensureRemixSolutionAccessTablePromise = null
      throw error
    })
  }

  await ensureRemixSolutionAccessTablePromise
}

export const getLatestActiveRemixSolutionAccess = async (responseId: string, viewerId: string) => {
  await ensureRemixSolutionAccessTable()
  const rows = await prisma.$queryRawUnsafe<AccessRow[]>(
    `
      SELECT *
      FROM remix_solution_view_access
      WHERE response_id = $1
        AND viewer_id = $2
        AND consumed_at IS NULL
        AND status IN ('requested', 'granted')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    responseId,
    viewerId,
  )

  return rows[0] || null
}

export const getRemixSolutionAccessMapForViewer = async (responseIds: string[], viewerId: string) => {
  await ensureRemixSolutionAccessTable()

  const safeIds = Array.from(new Set((responseIds || []).map((value) => String(value || '').trim()).filter(Boolean)))
  if (!safeIds.length || !viewerId) return new Map<string, RemixSolutionAccessSnapshot>()

  const rows = await prisma.$queryRawUnsafe<AccessRow[]>(
    `
      SELECT DISTINCT ON (response_id) *
      FROM remix_solution_view_access
      WHERE viewer_id = $1
        AND response_id = ANY($2)
        AND consumed_at IS NULL
        AND status IN ('requested', 'granted')
      ORDER BY response_id, created_at DESC
    `,
    viewerId,
    safeIds,
  )

  return new Map(rows.map((row) => [String(row.response_id), normalizeAccessRow(row)]))
}

export const createRemixSolutionAccessRequest = async (args: {
  sessionKey: string
  responseId: string
  ownerId: string
  viewerId: string
}) => {
  await ensureRemixSolutionAccessTable()

  const id = generateAccessId()
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO remix_solution_view_access (
        id,
        session_key,
        response_id,
        owner_id,
        viewer_id,
        status,
        requested_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, 'requested', NOW(), NOW(), NOW())
    `,
    id,
    args.sessionKey,
    args.responseId,
    args.ownerId,
    args.viewerId,
  )

  return id
}

export const updateRemixSolutionAccessNotificationIds = async (requestId: string, updates: {
  requestNotificationId?: string | null
  grantNotificationId?: string | null
}) => {
  await ensureRemixSolutionAccessTable()

  const sets: string[] = []
  const params: Array<string | null> = []
  let paramIndex = 1

  if (typeof updates.requestNotificationId !== 'undefined') {
    sets.push(`request_notification_id = $${paramIndex}`)
    params.push(updates.requestNotificationId)
    paramIndex += 1
  }

  if (typeof updates.grantNotificationId !== 'undefined') {
    sets.push(`grant_notification_id = $${paramIndex}`)
    params.push(updates.grantNotificationId)
    paramIndex += 1
  }

  if (!sets.length) return

  sets.push('updated_at = NOW()')
  params.push(requestId)
  await prisma.$executeRawUnsafe(
    `UPDATE remix_solution_view_access SET ${sets.join(', ')} WHERE id = $${paramIndex}`,
    ...params,
  )
}

export const getRemixSolutionAccessRequestById = async (requestId: string) => {
  await ensureRemixSolutionAccessTable()
  const rows = await prisma.$queryRawUnsafe<AccessRow[]>(
    'SELECT * FROM remix_solution_view_access WHERE id = $1 LIMIT 1',
    requestId,
  )
  return rows[0] || null
}

export const grantRemixSolutionAccessRequest = async (requestId: string) => {
  await ensureRemixSolutionAccessTable()
  await prisma.$executeRawUnsafe(
    `
      UPDATE remix_solution_view_access
      SET status = 'granted',
          granted_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
        AND status = 'requested'
        AND consumed_at IS NULL
    `,
    requestId,
  )
}

export const declineRemixSolutionAccessRequest = async (requestId: string) => {
  await ensureRemixSolutionAccessTable()
  await prisma.$executeRawUnsafe(
    `
      UPDATE remix_solution_view_access
      SET status = 'declined',
          updated_at = NOW()
      WHERE id = $1
        AND status = 'requested'
        AND consumed_at IS NULL
    `,
    requestId,
  )
}

export const consumeGrantedRemixSolutionAccess = async (requestId: string) => {
  await ensureRemixSolutionAccessTable()
  await prisma.$executeRawUnsafe(
    `
      UPDATE remix_solution_view_access
      SET status = 'consumed',
          consumed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
        AND status = 'granted'
        AND consumed_at IS NULL
    `,
    requestId,
  )
}
