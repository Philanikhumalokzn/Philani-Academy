export type TechnicalUserType = 'technical' | 'non-technical'

export type PlatformRole = 'admin' | 'teacher' | 'learner' | 'guest'

export type SessionRole = 'audience' | 'presenter'

export type PlatformRoleDisplayVariant = 'dashboard' | 'directory'

export type LessonCapabilities = {
  canManagePlatform: boolean
  canAccessTechnicalTools: boolean
  canAuthorLessons: boolean
  canOrchestrateLesson: boolean
  canManagePresenter: boolean
  canUseTeacherMediaControls: boolean
  canUseOwnMic: boolean
  canJoinLesson: boolean
  canLeaveLesson: boolean
  canViewLesson: boolean
  canParticipateAsAudience: boolean
  canPresentToSession: boolean
}

export type LessonCapabilityKey = keyof LessonCapabilities

export type LessonRoleProfile = {
  technicalUserType: TechnicalUserType
  platformRole: PlatformRole
  sessionRole: SessionRole
  inheritedPlatformRoles: PlatformRole[]
  inheritedSessionRoles: SessionRole[]
  capabilities: LessonCapabilities
}

const PLATFORM_ROLE_ORDER: PlatformRole[] = ['guest', 'learner', 'teacher', 'admin']

const SESSION_ROLE_ORDER: SessionRole[] = ['audience', 'presenter']

export const normalizePlatformRole = (value: unknown): PlatformRole => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'admin') return 'admin'
  if (normalized === 'teacher') return 'teacher'
  if (normalized === 'student' || normalized === 'learner') return 'learner'
  return 'guest'
}

export const getPlatformRoleDisplayLabel = (
  value: unknown,
  options?: {
    learnerGradeLabel?: string | null
    variant?: PlatformRoleDisplayVariant
    emptyWhenUnknown?: boolean
  }
) => {
  const rawValue = String(value || '').trim().toLowerCase()
  if (!rawValue && options?.emptyWhenUnknown) return ''

  const platformRole = normalizePlatformRole(rawValue)
  const variant = options?.variant ?? 'dashboard'

  if (platformRole === 'admin') return 'Admin'
  if (platformRole === 'teacher') return variant === 'directory' ? 'Teacher' : 'Instructor'
  if (platformRole === 'learner') {
    const learnerLabel = variant === 'directory' ? 'Learner' : 'Student'
    const gradeLabel = (options?.learnerGradeLabel || '').trim()
    return gradeLabel ? `${learnerLabel} (${gradeLabel})` : learnerLabel
  }

  return options?.emptyWhenUnknown ? '' : 'Guest'
}

export const getTechnicalUserType = (platformRole: PlatformRole): TechnicalUserType => {
  return platformRole === 'admin' ? 'technical' : 'non-technical'
}

const inheritPlatformRoles = (platformRole: PlatformRole): PlatformRole[] => {
  const rank = PLATFORM_ROLE_ORDER.indexOf(platformRole)
  return PLATFORM_ROLE_ORDER.slice(0, Math.max(rank, 0) + 1)
}

const inheritSessionRoles = (sessionRole: SessionRole): SessionRole[] => {
  const rank = SESSION_ROLE_ORDER.indexOf(sessionRole)
  return SESSION_ROLE_ORDER.slice(0, Math.max(rank, 0) + 1)
}

export const createLessonRoleProfile = (params?: {
  platformRole?: PlatformRole | string | null
  sessionRole?: SessionRole | null
}): LessonRoleProfile => {
  const platformRole = normalizePlatformRole(params?.platformRole)
  const sessionRole: SessionRole = params?.sessionRole === 'presenter' ? 'presenter' : 'audience'
  const inheritedPlatformRoles = inheritPlatformRoles(platformRole)
  const inheritedSessionRoles = inheritSessionRoles(sessionRole)

  const isAdmin = platformRole === 'admin'
  const isTeacherOrAbove = platformRole === 'teacher' || platformRole === 'admin'
  const canParticipate = platformRole !== 'guest'

  return {
    technicalUserType: getTechnicalUserType(platformRole),
    platformRole,
    sessionRole,
    inheritedPlatformRoles,
    inheritedSessionRoles,
    capabilities: {
      canManagePlatform: isAdmin,
      canAccessTechnicalTools: isAdmin,
      canAuthorLessons: isTeacherOrAbove,
      canOrchestrateLesson: isTeacherOrAbove,
      canManagePresenter: isTeacherOrAbove,
      canUseTeacherMediaControls: isTeacherOrAbove,
      canUseOwnMic: canParticipate,
      canJoinLesson: canParticipate,
      canLeaveLesson: canParticipate,
      canViewLesson: canParticipate,
      canParticipateAsAudience: canParticipate,
      canPresentToSession: canParticipate && sessionRole === 'presenter',
    },
  }
}

export const hasLessonCapabilityForRole = (
  platformRole: PlatformRole | string | null | undefined,
  capability: LessonCapabilityKey,
  sessionRole?: SessionRole | null
) => {
  return createLessonRoleProfile({ platformRole, sessionRole }).capabilities[capability]
}

export const isRecognizedLessonParticipantRole = (platformRole: PlatformRole | string | null | undefined) => {
  return normalizePlatformRole(platformRole) !== 'guest'
}

export const withSessionRole = (profile: LessonRoleProfile, sessionRole: SessionRole): LessonRoleProfile => {
  return createLessonRoleProfile({
    platformRole: profile.platformRole,
    sessionRole,
  })
}
