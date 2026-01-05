import type { NextApiRequest, NextApiResponse } from 'next'
import { execSync } from 'node:child_process'

type CommitInfo = {
  sha: string | null
  message: string | null
  date: string | null
}

function readEnvCommit(): CommitInfo {
  return {
    sha:
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
      null,
    message:
      process.env.VERCEL_GIT_COMMIT_MESSAGE ||
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_MESSAGE ||
      null,
    date: process.env.VERCEL_GIT_COMMIT_DATE || null
  }
}

function readGitCommit(): CommitInfo {
  const run = (cmd: string) => {
    try {
      return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      return null
    }
  }

  return {
    sha: run('git rev-parse HEAD'),
    message: run('git log -1 --pretty=%B'),
    date: run('git log -1 --date=iso-strict --pretty=%cd')
  }
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const envCommit = readEnvCommit()
  const gitCommit = envCommit.sha || envCommit.message || envCommit.date ? envCommit : readGitCommit()
  const commit: CommitInfo = {
    sha: envCommit.sha || gitCommit.sha,
    message: envCommit.message || gitCommit.message,
    date: envCommit.date || gitCommit.date
  }

  if (!commit.sha && !commit.message && !commit.date) {
    return res.status(500).json({ error: 'Unable to determine last commit' })
  }

  return res.status(200).json(commit)
}
