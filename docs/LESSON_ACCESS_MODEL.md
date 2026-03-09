# Lesson Access Model

This project uses hierarchical RBAC with session-scoped overlays for lesson surfaces.

## Platform roles

- `admin`: technical platform operator
- `teacher`: instructional operator
- `learner`: standard participant
- `guest`: unauthenticated or unprivileged viewer

Higher platform roles inherit lower platform rights.

Inheritance order:

- `guest` < `learner` < `teacher` < `admin`

## Session roles

- `audience`: baseline session participant
- `presenter`: temporary presentation overlay

Higher session roles inherit lower session rights.

Inheritance order:

- `audience` < `presenter`

## Composition rules

- Effective permissions are the union of platform-role inheritance and session-role inheritance.
- `presenter` is an overlay role, not a replacement for the platform role.
- A learner presenter is still a learner outside the presentation scope.
- A teacher presenter keeps teacher privileges and adds presenter rights.
- An admin presenter keeps platform-admin privileges and adds presenter rights.

## Capability model

The canonical capability builder is in `lib/lessonAccessControl.ts`.

Primary lesson capabilities:

- `canManagePlatform`
- `canAccessTechnicalTools`
- `canAuthorLessons`
- `canOrchestrateLesson`
- `canManagePresenter`
- `canUseTeacherMediaControls`
- `canUseOwnMic`
- `canJoinLesson`
- `canLeaveLesson`
- `canViewLesson`
- `canParticipateAsAudience`
- `canPresentToSession`

## Current implementation guidance

- Use role profiles at page boundaries.
- Pass `roleProfile` into lesson surfaces instead of introducing new boolean role props.
- Treat `canAccessTechnicalTools` as stricter than `canOrchestrateLesson`.
- Treat presenter state as session-scoped and temporary.
- Prefer capability checks over direct `role === ...` checks in lesson code.

## Practical mapping

- Admin: platform control, technical tools, lesson orchestration, presenter management, audience rights
- Teacher: lesson orchestration, presenter management, audience rights
- Learner audience: join, leave, listen, use own mic where allowed
- Learner presenter: learner audience rights plus session presentation rights
