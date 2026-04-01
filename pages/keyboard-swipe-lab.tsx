import type { NextPage } from 'next'
import Head from 'next/head'

import MyScriptMathCanvas from '../components/MyScriptMathCanvas'
import { createLessonRoleProfile } from '../lib/lessonAccessControl'

const teacherRoleProfile = createLessonRoleProfile({
  platformRole: 'teacher',
  sessionRole: 'presenter',
})

const KeyboardSwipeLabPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Keyboard Swipe Lab</title>
      </Head>
      <main className="h-screen w-screen bg-slate-100">
        <MyScriptMathCanvas
          gradeLabel="Grade 8"
          roomId="keyboard-swipe-lab"
          userId="keyboard-swipe-lab-user"
          userDisplayName="Keyboard Swipe Lab"
          canOrchestrateLesson
          roleProfile={teacherRoleProfile}
          forceEditable
          boardId="keyboard-swipe-lab-board"
        />
      </main>
    </>
  )
}

export default KeyboardSwipeLabPage