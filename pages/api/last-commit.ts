import type { NextApiRequest, NextApiResponse } from 'next'
import { execFileSync } from 'node:child_process'

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
    date:
      process.env.VERCEL_GIT_COMMIT_DATE ||
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_DATE ||
      null
  }
}

function readGitCommit(): CommitInfo {
  try {
    const output = execFileSync(
      'git',
      ['log', '-1', '--date=iso-strict', '--pretty=format:%H%x1f%B%x1f%cd'],
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }
    ).split('\u001f')

    const [sha, message, date] = output
    return {
      sha: sha?.trim() || null,
      message: message?.trim() || null,
      date: date?.trim() || null
    }
  } catch {
    return { sha: null, message: null, date: null }
  }
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).end()
  }

  const envCommit = readEnvCommit()
  const gitCommit = readGitCommit()
  const commit: CommitInfo = {
    sha: envCommit.sha || gitCommit.sha,
    message: envCommit.message || gitCommit.message,
    date: envCommit.date || gitCommit.date
  }

  if (!commit.sha) {
    return res.status(500).json({ error: 'Unable to determine last commit' })
  }

  return res.status(200).json(commit)
}
