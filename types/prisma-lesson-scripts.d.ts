// Temporary TypeScript server helper: Prisma Client already contains these delegates at runtime.
// If your editor still shows missing-property errors after `prisma generate`, reload the TS server / VS Code.
// This file must be a *module augmentation* (not a replacement declaration).

import '@prisma/client'

declare module '@prisma/client' {
  // Merge with PrismaClient class instance type.
  interface PrismaClient {
    lessonScriptTemplate: any
    lessonScriptVersion: any
    sessionLessonScript: any
  }
}

export {}
