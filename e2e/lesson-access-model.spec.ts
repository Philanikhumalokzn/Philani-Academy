import { test, expect } from '@playwright/test'

import { createLessonRoleProfile } from '../lib/lessonAccessControl'

test.describe('lesson access model matrix', () => {
  test('admin inherits platform and lesson control', async () => {
    const profile = createLessonRoleProfile({ platformRole: 'admin', sessionRole: 'audience' })

    expect(profile.technicalUserType).toBe('technical')
    expect(profile.capabilities.canManagePlatform).toBe(true)
    expect(profile.capabilities.canAccessTechnicalTools).toBe(true)
    expect(profile.capabilities.canOrchestrateLesson).toBe(true)
    expect(profile.capabilities.canParticipateAsAudience).toBe(true)
    expect(profile.capabilities.canPresentToSession).toBe(false)
  })

  test('teacher has lesson orchestration but not technical admin tools', async () => {
    const profile = createLessonRoleProfile({ platformRole: 'teacher', sessionRole: 'audience' })

    expect(profile.technicalUserType).toBe('non-technical')
    expect(profile.capabilities.canManagePlatform).toBe(false)
    expect(profile.capabilities.canAccessTechnicalTools).toBe(false)
    expect(profile.capabilities.canAuthorLessons).toBe(true)
    expect(profile.capabilities.canOrchestrateLesson).toBe(true)
    expect(profile.capabilities.canParticipateAsAudience).toBe(true)
    expect(profile.capabilities.canPresentToSession).toBe(false)
  })

  test('teacher presenter retains orchestration and gains session presentation', async () => {
    const profile = createLessonRoleProfile({ platformRole: 'teacher', sessionRole: 'presenter' })

    expect(profile.technicalUserType).toBe('non-technical')
    expect(profile.capabilities.canManagePlatform).toBe(false)
    expect(profile.capabilities.canAccessTechnicalTools).toBe(false)
    expect(profile.capabilities.canOrchestrateLesson).toBe(true)
    expect(profile.capabilities.canManagePresenter).toBe(true)
    expect(profile.capabilities.canPresentToSession).toBe(true)
  })

  test('learner audience keeps only baseline session participation', async () => {
    const profile = createLessonRoleProfile({ platformRole: 'learner', sessionRole: 'audience' })

    expect(profile.capabilities.canManagePlatform).toBe(false)
    expect(profile.capabilities.canAccessTechnicalTools).toBe(false)
    expect(profile.capabilities.canOrchestrateLesson).toBe(false)
    expect(profile.capabilities.canJoinLesson).toBe(true)
    expect(profile.capabilities.canUseOwnMic).toBe(true)
    expect(profile.capabilities.canParticipateAsAudience).toBe(true)
    expect(profile.capabilities.canPresentToSession).toBe(false)
  })

  test('learner presenter adds only session presentation powers', async () => {
    const profile = createLessonRoleProfile({ platformRole: 'learner', sessionRole: 'presenter' })

    expect(profile.technicalUserType).toBe('non-technical')
    expect(profile.capabilities.canManagePlatform).toBe(false)
    expect(profile.capabilities.canAccessTechnicalTools).toBe(false)
    expect(profile.capabilities.canOrchestrateLesson).toBe(false)
    expect(profile.capabilities.canParticipateAsAudience).toBe(true)
    expect(profile.capabilities.canPresentToSession).toBe(true)
  })

  test('admin presenter keeps technical authority and session presentation', async () => {
    const profile = createLessonRoleProfile({ platformRole: 'admin', sessionRole: 'presenter' })

    expect(profile.technicalUserType).toBe('technical')
    expect(profile.capabilities.canManagePlatform).toBe(true)
    expect(profile.capabilities.canAccessTechnicalTools).toBe(true)
    expect(profile.capabilities.canOrchestrateLesson).toBe(true)
    expect(profile.capabilities.canManagePresenter).toBe(true)
    expect(profile.capabilities.canPresentToSession).toBe(true)
  })
})
