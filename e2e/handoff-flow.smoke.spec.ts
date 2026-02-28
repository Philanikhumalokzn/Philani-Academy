import { expect, test } from '@playwright/test'
import {
  buildRosterAvatarLayout,
  deriveActivePresenterBadge,
  deriveAvailableRosterAttendees,
  resolveHandoffSelection,
  type PresenterPresenceClient,
} from '../lib/presenterControl'

test('handoff resolves all connected clientIds for the clicked user', () => {
  const connectedClients: PresenterPresenceClient[] = [
    { clientId: 'teacher-1', name: 'Teacher', userId: 't1', isAdmin: true },
    { clientId: 'student-a-1', name: 'Student A', userId: 'u-a', isAdmin: false },
    { clientId: 'student-a-2', name: 'Student A', userId: 'u-a', isAdmin: false },
    { clientId: 'student-b-1', name: 'Student B', userId: 'u-b', isAdmin: false },
  ]

  const result = resolveHandoffSelection({
    clickedClientId: 'student-a-1',
    clickedUserId: 'u-a',
    clickedUserKey: 'uid:u-a',
    clickedDisplayName: 'Student A',
    connectedClients,
    excludedClientIds: ['all', 'all-students'],
  })

  expect(result.nextClientIds.sort()).toEqual(['student-a-1', 'student-a-2'])
  expect(result.resolvedPresenterKey).toBe('uid:u-a')
  expect(result.resolvedDisplayName).toBe('Student A')
})

test('attendee derivation excludes admin, self, and active presenter', () => {
  const connectedClients: PresenterPresenceClient[] = [
    { clientId: 'teacher-1', name: 'Teacher', userId: 't1', isAdmin: true },
    { clientId: 'student-a-1', name: 'Student A', userId: 'u-a', isAdmin: false },
    { clientId: 'student-a-2', name: 'Student A', userId: 'u-a', isAdmin: false },
    { clientId: 'student-b-1', name: 'Student B', userId: 'u-b', isAdmin: false },
    { clientId: 'student-c-1', name: 'Student C', userId: 'u-c', isAdmin: false },
  ]

  const attendees = deriveAvailableRosterAttendees({
    connectedClients,
    selfClientId: 'teacher-1',
    selfUserId: 't1',
    activePresenterUserKey: 'uid:u-a',
    activePresenterClientIds: new Set(['student-a-1', 'student-a-2']),
    excludedClientIds: ['all', 'all-students'],
  })

  expect(attendees.map(a => a.userKey).sort()).toEqual(['uid:u-b', 'uid:u-c'])
})

test('roster layout keeps a single presenter badge and shows attendees when roster is open', () => {
  const connectedClients: PresenterPresenceClient[] = [
    { clientId: 'student-a-1', name: 'Student A', userId: 'u-a', isAdmin: false },
    { clientId: 'student-b-1', name: 'Student B', userId: 'u-b', isAdmin: false },
    { clientId: 'student-c-1', name: 'Student C', userId: 'u-c', isAdmin: false },
  ]

  const activePresenterBadge = deriveActivePresenterBadge({
    activePresenterUserKey: 'uid:u-a',
    activePresenterClientIds: new Set(['student-a-1']),
    connectedClients,
    fallbackInitial: 'P',
  })

  const availableAttendees = deriveAvailableRosterAttendees({
    connectedClients,
    selfClientId: 'teacher-1',
    selfUserId: 't1',
    activePresenterUserKey: 'uid:u-a',
    activePresenterClientIds: new Set(['student-a-1']),
    excludedClientIds: ['all', 'all-students'],
  })

  const closedLayout = buildRosterAvatarLayout({
    activePresenterBadge,
    availableAttendees,
    overlayRosterVisible: false,
    attendeeInitialFallback: 'U',
  })
  const openLayout = buildRosterAvatarLayout({
    activePresenterBadge,
    availableAttendees,
    overlayRosterVisible: true,
    attendeeInitialFallback: 'U',
  })

  const closedAll = [...closedLayout.top, ...closedLayout.bottom]
  const openAll = [...openLayout.top, ...openLayout.bottom]

  expect(closedAll.length).toBe(1)
  expect(closedAll[0].kind).toBe('presenter')
  expect(openAll.filter(x => x.kind === 'presenter')).toHaveLength(1)
  expect(openAll.filter(x => x.kind === 'attendee')).toHaveLength(2)
})
