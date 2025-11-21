-- Ensure Grade enum exists before referencing it
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'grade') THEN
        CREATE TYPE "Grade" AS ENUM ('GRADE_8', 'GRADE_9', 'GRADE_10', 'GRADE_11', 'GRADE_12');
    END IF;
END
$$;

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "grade" "Grade" NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
