import { GetServerSideProps } from 'next'
import React from 'react'
import { getSession } from 'next-auth/react'
import prisma from '../../lib/prisma'
import JitsiRoom from '../../components/JitsiRoom'

// Simple grade page: students are redirected to their own grade; teachers/admins can view any grade via URL
export default function GradePage({ grade, sessions, roomName, sessionId, displayName }: any) {
  return (
    <main className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Grade {grade}</h1>
        {roomName ? (
          <div className="mb-6">
            <JitsiRoom roomName={roomName} displayName={displayName} sessionId={sessionId} />
          </div>
        ) : (
          <p className="muted mb-6">No live class currently running for Grade {grade}.</p>
        )}
        <div className="card">
          <h2 className="font-semibold mb-3">Upcoming sessions</h2>
          <ul className="space-y-3">
            {sessions.map((s: any) => (
              <li key={s.id} className="p-3 rounded border">
                <div className="font-medium">{s.title}</div>
                <div className="text-sm muted">{new Date(s.startsAt).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  )
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const session = await getSession(ctx)
  if (!session) return { redirect: { destination: '/api/auth/signin', permanent: false } }

  // Determine user's grade if student
  const role = (session as any).user?.role
  let userGrade: number | null = null
  if (role === 'student') {
    try {
      const sp = await (prisma as any).studentProfile.findUnique({ where: { userId: (session as any).user?.id || (session as any).user?.sub } })
      if (sp) userGrade = sp.grade
    } catch {}
  }

  const urlGrade = Number(ctx.params?.grade)
  if (role === 'student') {
    if (!userGrade) return { redirect: { destination: '/profile', permanent: false } }
    if (!Number.isInteger(urlGrade) || urlGrade !== userGrade) {
      return { redirect: { destination: `/grade/${userGrade}`, permanent: false } }
    }
  }
  const effectiveGrade = Number.isInteger(urlGrade) ? urlGrade : (userGrade || 12)

  // Fetch upcoming sessions for this grade
  const sessions = await (prisma as any).sessionRecord.findMany({ where: { grade: effectiveGrade }, orderBy: { startsAt: 'asc' } })

  // Check if there's a currently running session and get room details
  let roomName: string | null = null
  let sessionId: string | null = null
  try {
    const now = new Date()
    const running = sessions.find((s: any) => new Date(s.startsAt) <= now) || null
    if (running) {
      sessionId = running.id
      const roomRes = await fetch(`${process.env.NEXTAUTH_URL || ''}/api/sessions/${running.id}/room`)
      if (roomRes.ok) {
        const data = await roomRes.json()
        roomName = data?.roomName || null
      }
    }
  } catch {}

  return {
    props: {
      grade: effectiveGrade,
      sessions: JSON.parse(JSON.stringify(sessions)),
      roomName: roomName || null,
      sessionId: sessionId || null,
      displayName: (session as any).user?.name || (session as any).user?.email || 'Learner'
    }
  }
}
