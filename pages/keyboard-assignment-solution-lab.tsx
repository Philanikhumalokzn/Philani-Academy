import type { NextPage } from 'next'
import Head from 'next/head'

import MyScriptMathCanvas from '../components/MyScriptMathCanvas'
import { createLessonRoleProfile } from '../lib/lessonAccessControl'

const teacherRoleProfile = createLessonRoleProfile({
  platformRole: 'teacher',
  sessionRole: 'presenter',
})

const KeyboardAssignmentSolutionLabPage: NextPage = () => {
  return (
    <>
      <Head>
        <title>Keyboard Assignment Solution Lab</title>
      </Head>
      <main className="h-screen w-screen bg-slate-100">
        <MyScriptMathCanvas
          gradeLabel="Grade 8"
          roomId="keyboard-assignment-solution-lab"
          userId="keyboard-assignment-solution-lab-user"
          userDisplayName="Keyboard Assignment Solution Lab"
          canOrchestrateLesson
          roleProfile={teacherRoleProfile}
          forceEditable
          boardId="keyboard-assignment-solution-lab-board"
          assignmentSubmission={{
            sessionId: 'keyboard-assignment-solution-lab-board',
            assignmentId: 'keyboard-assignment-solution-lab-assignment',
            questionId: 'keyboard-assignment-solution-lab-question',
            kind: 'solution',
          }}
        />
      </main>
    </>
  )
}

export default KeyboardAssignmentSolutionLabPage