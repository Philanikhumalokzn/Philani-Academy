export type FiveEPhase = 'engage' | 'explore' | 'explain' | 'elaborate' | 'evaluate'

export type LessonAudience = 'whole-class' | 'small-group' | 'individual'
export type LessonMode = 'live' | 'self-paced' | 'hybrid'

export type ScriptRole = 'teacher' | 'learner' | 'system'

export type ScriptStepKind =
  | 'say'
  | 'prompt'
  | 'activity'
  | 'check'
  | 'explain'
  | 'demo'
  | 'discussion'
  | 'practice'
  | 'reflection'
  | 'resource'
  | 'board-action'

export type ScriptResource = {
  kind: 'material' | 'link' | 'latex' | 'image'
  title?: string
  url?: string
  materialId?: string
  latex?: string
}

export type ScriptAction =
  | { type: 'open_material'; materialId: string }
  | { type: 'open_url'; url: string }
  | { type: 'set_canvas_mode'; mode: 'draw' | 'notes' | 'overlay-controls' }
  | { type: 'toggle_diagram_tray' }
  | { type: 'set_diagram_open'; isOpen: boolean }
  | { type: 'convert_to_notes' }

export type ScriptCheckpoint = {
  id: string
  prompt: string
  expected?: string
  successCriteria?: string[]
  misconceptionsToWatch?: string[]
  quickRubric?: Array<{ label: string; description: string }>
}

export type LessonScriptStep = {
  id: string
  phase: FiveEPhase
  kind: ScriptStepKind
  role: ScriptRole

  /** Short label for quick navigation (e.g. "Hook", "Guided practice"). */
  title: string

  /**
   * Timing is intentionally lightweight and relative.
   * - durationSec drives the planned pacing.
   * - targetStartSec is optional for aligning to an overall timeline.
   */
  durationSec: number
  targetStartSec?: number

  /** What the teacher says / what the learner sees (Markdown-friendly). */
  script?: string

  /** Optional learner-facing instruction (used for self-paced mode). */
  learnerTask?: string

  audience?: LessonAudience

  resources?: ScriptResource[]
  checkpoints?: ScriptCheckpoint[]
  actions?: ScriptAction[]

  /** Optional branch hints (runtime decides how to branch). */
  ifStrugglingGoToStepId?: string
  ifMasteredGoToStepId?: string
}

export type LessonScriptPhase = {
  phase: FiveEPhase
  title: string
  targetMinutes?: number
  steps: LessonScriptStep[]
}

export type LessonScriptV1 = {
  version: 1

  id: string
  title: string
  grade?: string
  subject?: string
  topic?: string

  mode: LessonMode
  totalTargetMinutes?: number

  objectives?: string[]
  prerequisites?: string[]
  vocabulary?: string[]

  phases: LessonScriptPhase[]
}

export type LessonScript = LessonScriptV1
