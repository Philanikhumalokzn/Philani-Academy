export type NotebookStepRecord = {
  latex: string
  symbols: any[]
  jiix?: string | null
  rawStrokes?: any[]
  strokeGroups?: any[]
  createdAt?: string | number
  updatedAt?: string | number
}

export type NotebookDiagramRecord = {
  id: string
  title: string
  imageUrl: string
  order: number
  annotations: unknown | null
}

export type NotebookDiagramState = {
  activeDiagramId: string | null
  isOpen: boolean
}

export type NotebookRevisionKind = 'checkpoint' | 'draft-save' | 'final-save'

export type NotebookInteractionState = {
  canvasMode?: 'math' | 'raw-ink'
  topPanelEditingMode?: boolean
  selectedStepIndex?: number | null
  editingStepIndex?: number | null
  studentEditingStepIndex?: number | null
  diagramTool?: 'select' | 'pen' | 'arrow' | 'eraser'
  diagramSelection?: { kind: 'stroke' | 'arrow'; id: string } | null
  splitRatio?: number | null
}

export type NotebookHistoryState = {
  rawInkRedoStack?: any[][]
  stepNavRedoStack?: number[]
  diagramUndoStack?: Array<unknown | null>
  diagramRedoStack?: Array<unknown | null>
}

export type NotebookTextOverlayState = {
  isOpen: boolean
  activeId: string | null
}

export type NotebookTextBoxRecord = {
  id: string
  text: string
  x: number
  y: number
  w: number
  h: number
  z: number
  surface: 'stage'
  visible: boolean
  locked?: boolean
}

export type NotebookTextTimelineEvent = {
  ts: number
  kind: 'overlay-state' | 'box'
  action: string
  boxId?: string
  visible?: boolean
  textSnippet?: string
}

export type SolutionSessionEditorStateV2 = {
  content?: {
    steps?: NotebookStepRecord[]
    draftStep?: NotebookStepRecord | null
    aggregatedLatex?: string
    stackedLatex?: string
    rawInkStrokes?: any[]
    diagrams?: NotebookDiagramRecord[]
    diagramState?: NotebookDiagramState | null
    textOverlay?: {
      overlayState?: NotebookTextOverlayState | null
      boxes?: NotebookTextBoxRecord[]
      timeline?: NotebookTextTimelineEvent[]
    } | null
  }
  interaction?: NotebookInteractionState
  history?: NotebookHistoryState
}

export type NotesSaveRecord = {
  id: string
  title: string
  latex: string
  shared: boolean
  noteId?: string | null
  payload?: unknown | null
  createdAt?: string
  updatedAt?: string
}

export type QuestionPayloadV1 = {
  kind: 'question-v1'
  noteId: string
  questionId: string
  createdAt: number
  steps: NotebookStepRecord[]
}

export type SolutionSessionPayloadV2 = {
  kind: 'solution-session-v2'
  notebook?: {
    notebookId?: string
    sectionId?: string | null
    solutionId?: string
    revisionId?: string
    revisionKind?: NotebookRevisionKind
    status?: 'draft' | 'final'
    title?: string
    label?: string | null
  }
  editorState?: SolutionSessionEditorStateV2
}

export type SupportedNotebookPayload = QuestionPayloadV1 | SolutionSessionPayloadV2

export function buildQuestionPayloadV1(noteId: string, steps: NotebookStepRecord[]): QuestionPayloadV1 {
  return {
    kind: 'question-v1',
    noteId,
    questionId: noteId,
    createdAt: Date.now(),
    steps: normalizeNotebookSteps(steps),
  }
}

export function isQuestionPayloadV1(payload: unknown): payload is QuestionPayloadV1 {
  return Boolean(
    payload
    && typeof payload === 'object'
    && (payload as any).kind === 'question-v1'
    && Array.isArray((payload as any).steps)
  )
}

export function isSolutionSessionPayloadV2(payload: unknown): payload is SolutionSessionPayloadV2 {
  return Boolean(
    payload
    && typeof payload === 'object'
    && (payload as any).kind === 'solution-session-v2'
  )
}

export function isSupportedNotebookPayload(payload: unknown): payload is SupportedNotebookPayload {
  return isQuestionPayloadV1(payload) || isSolutionSessionPayloadV2(payload)
}

export function normalizeNotebookSteps(steps: unknown): NotebookStepRecord[] {
  if (!Array.isArray(steps)) return []
  return steps
    .filter(step => step && typeof step === 'object')
    .map((step: any) => ({
      latex: typeof step?.latex === 'string' ? step.latex : '',
      symbols: Array.isArray(step?.symbols) ? step.symbols : [],
      jiix: typeof step?.jiix === 'string' ? step.jiix : null,
      rawStrokes: Array.isArray(step?.rawStrokes) ? step.rawStrokes : undefined,
      strokeGroups: Array.isArray(step?.strokeGroups) ? step.strokeGroups : undefined,
      createdAt: step?.createdAt,
      updatedAt: step?.updatedAt,
    }))
    .filter(step => String(step.latex || '').trim() || step.symbols.length || Boolean(step.jiix) || (Array.isArray(step.rawStrokes) && step.rawStrokes.length) || (Array.isArray(step.strokeGroups) && step.strokeGroups.length))
}

export function extractNotebookStepsFromPayload(payload: unknown): NotebookStepRecord[] {
  if (isQuestionPayloadV1(payload)) {
    return normalizeNotebookSteps(payload.steps)
  }
  if (isSolutionSessionPayloadV2(payload)) {
    return normalizeNotebookSteps(payload.editorState?.content?.steps)
  }
  return []
}

export function isNotebookSaveRecord(record: unknown): record is NotesSaveRecord {
  return Boolean(record && typeof record === 'object' && isSupportedNotebookPayload((record as any).payload))
}

export function getNotebookRevisionKind(payload: unknown): NotebookRevisionKind {
  if (isSolutionSessionPayloadV2(payload)) {
    const revisionKind = payload.notebook?.revisionKind
    if (revisionKind === 'checkpoint' || revisionKind === 'draft-save' || revisionKind === 'final-save') {
      return revisionKind
    }
    return 'final-save'
  }
  return 'final-save'
}

export function isNotebookLibraryRecord(record: unknown): record is NotesSaveRecord {
  if (!isNotebookSaveRecord(record)) return false
  return getNotebookRevisionKind((record as any).payload) !== 'checkpoint'
}

export function extractNotebookSolutionId(save: Pick<NotesSaveRecord, 'noteId' | 'payload'> | null | undefined): string | null {
  const directNoteId = typeof save?.noteId === 'string' ? save.noteId.trim() : ''
  if (directNoteId) return directNoteId

  const payload = save?.payload
  if (isSolutionSessionPayloadV2(payload)) {
    const solutionId = typeof payload.notebook?.solutionId === 'string' ? payload.notebook.solutionId.trim() : ''
    if (solutionId) return solutionId
  }
  if (isQuestionPayloadV1(payload)) {
    const noteId = typeof payload.noteId === 'string' ? payload.noteId.trim() : ''
    if (noteId) return noteId
  }
  return null
}

export function extractNotebookSaveState(save: Pick<NotesSaveRecord, 'latex' | 'payload'>) {
  const steps = extractNotebookStepsFromPayload(save?.payload)
  const mergedSymbols = steps.flatMap(step => (Array.isArray(step.symbols) ? step.symbols : []))
  const payloadLatex = steps
    .map(step => String(step?.latex || '').trim())
    .filter(Boolean)
    .join(' \\\\ ')
    .trim()
  const loadedLatex = typeof save?.latex === 'string' ? save.latex.trim() : ''
  return {
    steps,
    mergedSymbols,
    payloadLatex,
    continuityLatex: loadedLatex || payloadLatex,
  }
}

export function buildSolutionSessionPayloadV2(input: {
  notebook?: SolutionSessionPayloadV2['notebook']
  editorState: SolutionSessionEditorStateV2
}): SolutionSessionPayloadV2 {
  return {
    kind: 'solution-session-v2',
    notebook: input.notebook,
    editorState: input.editorState,
  }
}

export function extractSolutionSessionEditorState(payload: unknown): SolutionSessionEditorStateV2 | null {
  if (!isSolutionSessionPayloadV2(payload)) return null
  if (!payload.editorState || typeof payload.editorState !== 'object') return null
  return payload.editorState
}