# Stacked Canvas Notebook Model

This document defines the professional content model and UX for stacked-canvas teaching notes where a presenter builds worked solutions step by step, explicitly saves them, and later reloads them with full editing fidelity.

## Goals

- Treat a live group of stacked-canvas steps as one coherent working unit.
- Let the presenter explicitly finalize that working unit into a saved solution.
- Group many saved solutions into a lesson notebook or exercise notebook.
- Preserve enough state that reloading a saved draft or saved solution feels identical to continuing the original editing session.
- Preserve undo/redo, editing mode, strokes, timestamps, diagram state, text modules, and LaTeX state as first-class data.

## Core Model

The model has five levels.

### 1. Step

A step is one authored mathematical move in the stacked solution.

Examples:

- `2x + 3 = 11`
- `2x = 8`
- `x = 4`

Each step stores both rendered math and the raw editable state that produced it.

### 2. Solution Draft

A solution draft is the active editable working set for one problem target.

Examples:

- `Question 1.1`
- `Question 1.2`
- `Exercise 1(a)`
- `Exercise 1(b)`

This is the thing the presenter is currently building on the stacked canvas. It is not yet a permanent lesson artifact.

### 3. Saved Solution

A saved solution is an explicitly finalized solution draft.

This is created by the floppy save action. A saved solution should still remain fully reloadable into an editable session.

### 4. Notebook Section

An optional organizational level above saved solutions.

Examples:

- `Question 1`
- `Exercise 1`
- `Worked Examples`

Use this when the lesson needs nested grouping like `1.1`, `1.2`, `1(a)`, `1(b)`.

### 5. Lesson Notebook

The notebook is the ordered collection of saved solutions for a session, lesson, exercise set, or worked-example pack.

Examples:

- `Algebra Lesson 3 Notebook`
- `Exercise 1 Worked Solutions`
- `Grade 11 Functions - Notes`

## Persistence Types

There are three persistence modes. They must not be conflated.

### Continuity Checkpoint

System-managed recovery state.

Use cases:

- presenter handoff
- reconnect after network loss
- crash recovery
- periodic autosave

This is operational persistence, not pedagogical finalization.

### Saved Draft

An explicitly saved but still in-progress editable draft.

This is useful when the presenter wants to pause work without declaring the solution complete.

### Saved Solution

An explicitly finalized pedagogical unit.

This is the normal outcome of the floppy save confirmation flow.

## Full-Fidelity Requirement

Reloading a saved draft or saved solution must recreate the original editing session, not only the visible output.

That means each saved model component must store two categories of state:

- content state
- interaction state

### Content State

Content state is what the learner or presenter can see.

- ordered steps
- current draft line
- aggregated LaTeX
- raw symbol events from handwriting recognition
- raw ink strokes with points and timestamps
- text modules and their ordering
- diagram records and their annotation state
- selected or active page index
- stacked top-panel content
- published snapshot if one exists

### Interaction State

Interaction state is what makes the editor feel identical after reload.

- undo stack
- redo stack
- currently active tool
- active selection
- step currently being edited
- top-panel selection state
- current cursor or insertion target
- eraser mode state
- open diagram and active diagram tool
- text editing mode state
- split ratio and relevant canvas viewport state
- any internal editor revision ids or history tokens needed to restore exact editing behavior

If interaction state is not saved, a reloaded item may look correct but will not behave like the original. That is not acceptable for this workflow.

## Canonical Data Shape

The cleanest model is to introduce an `EditorSessionState` bundle and make every saveable unit point to one.

```ts
type LessonNotebook = {
  id: string
  sessionKey: string
  title: string
  status: 'active' | 'archived'
  sectionOrder: string[]
  createdAt: string
  updatedAt: string
}

type NotebookSection = {
  id: string
  notebookId: string
  title: string
  order: number
  solutionOrder: string[]
  createdAt: string
  updatedAt: string
}

type SolutionRecord = {
  id: string
  notebookId: string
  sectionId?: string | null
  title: string
  label?: string | null
  status: 'draft' | 'final'
  latestRevisionId: string
  createdByUserId?: string | null
  createdByUserKey?: string | null
  createdAt: string
  updatedAt: string
}

type SolutionRevision = {
  id: string
  solutionId: string
  revisionNumber: number
  kind: 'checkpoint' | 'draft-save' | 'final-save'
  editorState: EditorSessionState
  createdAt: string
  createdByUserId?: string | null
  createdByUserKey?: string | null
}

type EditorSessionState = {
  version: 1
  scope: {
    sessionKey: string
    boardId?: string | null
    pageIndex?: number | null
    phaseKey?: string | null
    pointId?: string | null
    pointTitle?: string | null
  }
  content: {
    steps: StepState[]
    draftStep: DraftStepState | null
    aggregatedLatex: string
    topPanelLatex: string
    textModules: TextModuleState[]
    diagrams: DiagramState[]
    activeDiagramId?: string | null
    publishedSnapshot?: SnapshotState | null
  }
  interaction: {
    mode: 'math' | 'raw-ink'
    activeTool: 'pen' | 'eraser' | 'select' | 'arrow' | 'text'
    topPanelEditingMode: boolean
    selectedStepIndex: number | null
    editingStepIndex: number | null
    splitRatio?: number | null
    mobileTrayState?: {
      latexOpen: boolean
      diagramOpen: boolean
      pickerType?: 'text' | 'diagram' | null
    }
    diagramTool?: 'select' | 'pen' | 'arrow' | 'eraser'
    selection?: SelectionState | null
  }
  history: {
    undoStack: HistoryEntry[]
    redoStack: HistoryEntry[]
    currentRevisionToken?: string | null
  }
  telemetry: {
    createdAt: string
    updatedAt: string
    lastStrokeAt?: string | null
    lastLatexEditAt?: string | null
  }
}

type StepState = {
  id: string
  order: number
  latex: string
  symbols: unknown[]
  rawStrokes: RawStrokeState[]
  createdAt: string
  updatedAt: string
}

type DraftStepState = {
  latex: string
  symbols: unknown[]
  rawStrokes: RawStrokeState[]
  startedAt: string
  updatedAt: string
}

type RawStrokeState = {
  id: string
  pointerType: string
  color?: string | null
  width?: number | null
  points: Array<{ x: number; y: number; t: number }>
  startedAt: string
  endedAt?: string | null
}

type HistoryEntry = {
  id: string
  kind: string
  at: string
  before: Partial<EditorSessionState>
  after: Partial<EditorSessionState>
}
```

## Key Rule

Every saveable thing stores an `EditorSessionState`, not only a flattened LaTeX string.

Flattened LaTeX is a derived view. It is not enough to support true editing restoration.

## Undo/Redo Model

To make reload behave like the original session, undo and redo must be persisted with the saveable component.

There are two implementation strategies.

### Option A: Persist Explicit Undo/Redo Stacks

Store the exact history stacks as serialized history entries.

Advantages:

- closest UX match after reload
- simplest mental model for restore

Disadvantages:

- can become large
- requires careful migration when editor internals change

### Option B: Persist Command Journal Plus Periodic Checkpoints

Store an append-only action log plus periodic full snapshots.

Advantages:

- more scalable
- easier auditing

Disadvantages:

- replay logic is more complex
- exact parity depends on command determinism

### Recommendation

For this stacked canvas workflow, use a hybrid model:

- persist a full `EditorSessionState` snapshot on every explicit save
- persist compact command-history entries for undo and redo
- persist periodic continuity checkpoints without finalizing the solution

That gives exact restore semantics without making reload depend entirely on long replay chains.

## Save Semantics

### Single-Tap Floppy

Single tap should not immediately finalize.

Recommended behavior:

- if the current draft is dirty, arm save mode
- show inline confirmation affordance
- keep the presenter in context

### Second Tap Within Save Window

Second tap finalizes the current draft as a saved solution.

System actions:

- create or update `SolutionRecord`
- append `SolutionRevision` with `kind: 'final-save'`
- snapshot full `EditorSessionState`
- mark solution status as `final`
- open a fresh empty `SolutionDraft`

### Save Draft Action

Separate from final save, there should be an explicit `Save Draft` affordance in the overflow menu or long-press save affordance.

This creates:

- `SolutionRevision.kind = 'draft-save'`
- `SolutionRecord.status = 'draft'`

### Autosave

Autosave creates:

- `SolutionRevision.kind = 'checkpoint'`

Autosave must never be presented as a finalized saved solution unless the presenter explicitly promoted it.

## UX Model

The stacked canvas needs to show the notebook structure without interrupting writing flow.

### Primary Surfaces

#### A. Active Draft Header

At the top of the stacked canvas, show the active working target.

Example header:

- `Question 1.1`
- `Draft`
- `Unsaved changes`

Header actions:

- rename target
- save draft
- finalize solution
- move to section

#### B. Solution Rail

A lightweight left or top rail listing saved solutions in order.

Each item should show:

- label
- status badge: `Draft` or `Saved`
- modified indicator if the loaded state differs from latest saved revision

Selecting an item should load its full `EditorSessionState`, not only its LaTeX.

#### C. Section Grouping

If used, sections should visually group related solutions.

Example:

- `Question 1`
- `1.1 Solve for x`
- `1.2 Check the solution`

or

- `Exercise 1`
- `(a)`
- `(b)`

#### D. Save Affordance

The floppy interaction should communicate state clearly.

Recommended states:

- idle
- armed to save
- saved draft
- finalized solution
- dirty since last save

The user must always know whether they are editing:

- a new unsaved draft
- a previously saved draft
- a finalized solution revision now reopened for editing

### Reopen Behavior

When a saved draft or saved solution is loaded:

- the stacked canvas restores the exact steps
- the bottom draft line restores exactly
- raw stroke editing works immediately
- diagram annotations reopen exactly
- text modules reappear exactly
- undo/redo operate from restored history
- current selection and editing target are restored when reasonable

If a saved solution is reopened and then changed, the UI should show:

- `Editing saved solution`
- `Unsaved changes`

The user may then either:

- save as a new revision
- save as a new solution
- discard changes

## Current Code Alignment

The existing canvas already contains primitives that align with this model.

- `adminSteps` is the active stacked step list.
- `NotesSaveRecord` is the current saved note shell.
- question payloads already carry step arrays in `payload.kind === 'question-v1'`.
- continuity saves already exist for presenter handoff.

The main architectural change is to promote the payload from a loose note payload into a first-class `EditorSessionState` bundle.

That means the current `NotesSaveRecord` should evolve conceptually into:

- notebook metadata
- solution metadata
- revision metadata
- full editor session snapshot

## Recommended Payload Evolution

Replace generic `question-v1` with a richer versioned payload.

```ts
type SolutionPayloadV2 = {
  kind: 'solution-session-v2'
  notebook: {
    notebookId: string
    sectionId?: string | null
    solutionId: string
    revisionId: string
    status: 'draft' | 'final'
    title: string
    label?: string | null
  }
  editorState: EditorSessionState
}
```

## Non-Negotiable Fidelity Rules

To satisfy the UX requirement, the following must be true.

1. A saved draft or saved solution cannot be reconstructed only from joined LaTeX lines.
2. Raw stroke geometry and timestamps must be preserved.
3. Diagram annotations and text modules must be preserved in editable form.
4. Undo and redo state must be restorable.
5. The currently loaded item must behave like an uninterrupted session continuation.
6. Continuity checkpoints and final saved solutions must be stored separately, even if they share the same editor-state schema.

## Recommended Next Implementation Steps

1. Introduce `EditorSessionState` and start producing it from the current canvas state.
2. Extend the current note payload to `solution-session-v2` while keeping backward compatibility with `question-v1`.
3. Split persistence into `checkpoint`, `draft-save`, and `final-save`.
4. Add a visible stacked-canvas draft header and solution rail.
5. Restore undo and redo from serialized history when loading a saved component.
6. Only after the persistence contract is stable, refine the floppy interaction and notebook browsing UX.
