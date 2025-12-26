import type { FiveEPhase, LessonScript, LessonScriptPhase, LessonScriptStep } from '../types/lessonScript'

const PHASES: FiveEPhase[] = ['engage', 'explore', 'explain', 'elaborate', 'evaluate']

export function isFiveEPhase(value: any): value is FiveEPhase {
  return PHASES.includes(value)
}

export function normalizeLessonScript(script: LessonScript): LessonScript {
  if (script.version !== 1) return script

  const phases: LessonScriptPhase[] = Array.isArray(script.phases) ? script.phases : []

  // Ensure phase order is always 5E.
  const ordered = [...phases].sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase))

  const normalizedPhases = ordered.map(phase => {
    const steps = Array.isArray(phase.steps) ? phase.steps : []
    const normalizedSteps: LessonScriptStep[] = steps.map(step => ({
      ...step,
      durationSec: Number.isFinite(step.durationSec) && step.durationSec > 0 ? step.durationSec : 60,
    }))

    return { ...phase, steps: normalizedSteps }
  })

  return { ...script, phases: normalizedPhases }
}

export function computePlannedTimeline(script: LessonScript): Array<{ stepId: string; phase: FiveEPhase; startSec: number; endSec: number; title: string }> {
  const normalized = normalizeLessonScript(script)
  let cursor = 0
  const out: Array<{ stepId: string; phase: FiveEPhase; startSec: number; endSec: number; title: string }> = []

  for (const phase of normalized.phases) {
    for (const step of phase.steps) {
      const start = Number.isFinite(step.targetStartSec) ? Math.max(0, step.targetStartSec!) : cursor
      const end = start + step.durationSec
      out.push({ stepId: step.id, phase: phase.phase, startSec: start, endSec: end, title: step.title })
      cursor = Math.max(cursor, end)
    }
  }

  return out
}
