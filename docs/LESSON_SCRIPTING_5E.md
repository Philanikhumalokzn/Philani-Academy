# Lesson scripting (5E) – Philani Academy

This project supports lessons that are partially or fully scripted. The goal is to make teaching **repeatable**, **pacing-aware**, and usable in both:

- **Live mode** (teacher runs the script during a scheduled session)
- **Self-paced mode** (learner progresses through the same script asynchronously)

## The 5E model

A lesson script is organized into 5 phases:

1. **Engage** – hook, prior knowledge, driving question
2. **Explore** – learners investigate / attempt problems with minimal direct instruction
3. **Explain** – learners articulate; teacher formalizes concepts, vocabulary, and worked examples
4. **Elaborate** – apply to new contexts, harder problems, connections, mixed practice
5. **Evaluate** – formative/summative checks + reflection

## Script format

We represent scripts as a JSON-like object (typed in `types/lessonScript.ts`).

Key design choices:

- **Relative timing**: each step has `durationSec` (planned pace). Optionally, a step can also specify `targetStartSec` for alignment to a timeline.
- **Single source of truth**: the same script can drive both live and self-paced experiences.
- **Checkpoints**: steps can include lightweight formative checks and common misconceptions.
- **Actions**: steps can optionally include app actions (e.g. open materials, toggle diagram tray).

## Core fields

- `phases[]`: ordered 5E phases
- `steps[]`: ordered steps inside each phase
- `durationSec`: planned duration of that step
- `script`: teacher-facing script (Markdown-friendly)
- `learnerTask`: learner-facing instruction (for self-paced)
- `checkpoints[]`: quick checks and success criteria
- `actions[]`: optional integration hooks

## Timing & pacing

Live mode:

- runtime starts a timer when the teacher starts the lesson
- the UI can show: planned vs actual time, plus current step
- teacher can pause, skip, or branch to remediation/extension

Self-paced mode:

- `durationSec` becomes a guideline rather than a strict timer
- checkpoints can be used to gate progress (optional)

## Example (minimal)

```ts
import type { LessonScript } from '../types/lessonScript'

export const example: LessonScript = {
  version: 1,
  id: 'gr10-linear-equations-01',
  title: 'Solving Linear Equations (One Variable)',
  grade: 'GRADE_10',
  subject: 'Maths',
  topic: 'Linear equations',
  mode: 'hybrid',
  totalTargetMinutes: 45,
  objectives: [
    'Solve one-step and two-step linear equations',
    'Explain each transformation using inverse operations',
  ],
  phases: [
    {
      phase: 'engage',
      title: 'Hook',
      targetMinutes: 5,
      steps: [
        {
          id: 'e1',
          phase: 'engage',
          kind: 'prompt',
          role: 'teacher',
          title: 'Quick mental puzzle',
          durationSec: 180,
          script: 'If $x + 3 = 11$, what is $x$? How do you know?',
          checkpoints: [{ id: 'cp1', prompt: 'Learner explains inverse operation', successCriteria: ['Subtract 3 from both sides'] }],
        },
      ],
    },
    {
      phase: 'explore',
      title: 'Try before taught',
      targetMinutes: 10,
      steps: [
        {
          id: 'x1',
          phase: 'explore',
          kind: 'activity',
          role: 'learner',
          title: 'Attempt 3 equations',
          durationSec: 600,
          learnerTask: 'Solve: (1) $2x=14$ (2) $x-5=9$ (3) $3x+2=17$. Show steps.',
        },
      ],
    },
    { phase: 'explain', title: 'Formalize', targetMinutes: 12, steps: [] },
    { phase: 'elaborate', title: 'Extend', targetMinutes: 13, steps: [] },
    { phase: 'evaluate', title: 'Check understanding', targetMinutes: 5, steps: [] },
  ],
}
```

## Next implementation steps (suggested)

1. Decide where scripts live:
   - attached to a scheduled `SessionRecord`, or
   - reusable templates per grade/topic with sessions referencing a template version.
2. Add persistence + versioning (Prisma models or JSON storage).
3. Build a minimal “Script Runner” panel for teachers (live) and a “Guided Steps” view for learners (self-paced).
