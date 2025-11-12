-- CreateTable
CREATE TABLE "StudentProfile" (
    "userId" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "schoolName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "StudentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Check constraint to enforce grade between 8 and 12
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_grade_check" CHECK ("grade" >= 8 AND "grade" <= 12);
