import { useEffect, useMemo, useRef, useState } from 'react'
import LessonStyledExcalidraw from './LessonStyledExcalidraw'

export type PublicSolveScene = {
  elements: any[]
  appState?: Record<string, any>
  files?: Record<string, any>
  updatedAt?: string | null
}

const cloneScenePart = <T,>(value: T): T => {
  try {
    if (typeof structuredClone === 'function') return structuredClone(value)
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

export const normalizePublicSolveScene = (value: any): PublicSolveScene | null => {
  if (!value || typeof value !== 'object') return null
  const elements = Array.isArray(value.elements) ? cloneScenePart(value.elements) : []
  const appState = value.appState && typeof value.appState === 'object' ? cloneScenePart(value.appState) : undefined
  const files = value.files && typeof value.files === 'object' ? cloneScenePart(value.files) : undefined
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : null
  return { elements, appState, files, updatedAt }
}

export const publicSolveSceneHasContent = (scene: PublicSolveScene | null | undefined) => {
  return Boolean(scene && Array.isArray(scene.elements) && scene.elements.some((element: any) => !element?.isDeleted))
}

const buildInitialData = (scene: PublicSolveScene | null | undefined) => {
  const normalized = normalizePublicSolveScene(scene) || { elements: [] }
  return {
    elements: Array.isArray(normalized.elements) ? normalized.elements : [],
    appState: {
      viewBackgroundColor: '#ffffff',
      currentItemStrokeColor: '#1f2937',
      currentItemBackgroundColor: 'transparent',
      ...(normalized.appState || {}),
    },
    files: normalized.files || {},
  }
}

const editorUiOptions = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false,
    clearCanvas: true,
    changeViewBackgroundColor: false,
    toggleTheme: false,
  },
} as const

const viewerUiOptions = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false,
    clearCanvas: false,
    changeViewBackgroundColor: false,
    toggleTheme: false,
  },
} as const

export function PublicSolveCanvasViewer({
  scene,
  className = '',
  emptyLabel = 'No canvas submitted yet.',
}: {
  scene: PublicSolveScene | null | undefined
  className?: string
  emptyLabel?: string
}) {
  const normalizedScene = useMemo(() => normalizePublicSolveScene(scene), [scene])

  if (!publicSolveSceneHasContent(normalizedScene)) {
    return (
      <div className={`rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 ${className}`.trim()}>
        {emptyLabel}
      </div>
    )
  }

  return (
    <div className={`overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.08)] ${className}`.trim()}>
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        Submitted canvas
      </div>
      <div className="h-[420px] bg-white">
        <LessonStyledExcalidraw
          key={normalizedScene?.updatedAt || 'viewer'}
          className="h-full"
          initialData={buildInitialData(normalizedScene)}
          viewModeEnabled
          zenModeEnabled
          gridModeEnabled={false}
          UIOptions={viewerUiOptions}
          renderTopRightUI={() => null}
        />
      </div>
    </div>
  )
}

export function PublicSolveComposer({
  title,
  prompt,
  imageUrl,
  initialScene,
  submitLabel = 'Submit solve',
  cancelLabel = 'Back',
  submitting = false,
  onCancel,
  onSubmit,
}: {
  title: string
  prompt?: string | null
  imageUrl?: string | null
  initialScene?: PublicSolveScene | null
  submitLabel?: string
  cancelLabel?: string
  submitting?: boolean
  onCancel?: () => void
  onSubmit: (scene: PublicSolveScene) => void | Promise<void>
}) {
  const excalidrawApiRef = useRef<any>(null)
  const sceneRef = useRef<PublicSolveScene>(normalizePublicSolveScene(initialScene) || { elements: [] })
  const [isReady, setIsReady] = useState(false)
  const [hasContent, setHasContent] = useState(publicSolveSceneHasContent(sceneRef.current))

  useEffect(() => {
    const normalized = normalizePublicSolveScene(initialScene) || { elements: [] }
    sceneRef.current = normalized
    setHasContent(publicSolveSceneHasContent(normalized))
    if (excalidrawApiRef.current?.updateScene) {
      excalidrawApiRef.current.updateScene(buildInitialData(normalized))
    }
  }, [initialScene])

  return (
    <div className="flex h-full flex-col bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_32%),linear-gradient(180deg,#eef4ff_0%,#f8fbff_28%,#ffffff_100%)] text-slate-900">
      <div className="border-b border-slate-200/80 bg-white/85 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#1877f2]">Solve</div>
            <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-slate-950">{title}</h1>
            {prompt ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{prompt}</p> : null}
          </div>
          {onCancel ? (
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          ) : null}
        </div>

        {imageUrl ? (
          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
            <img src={imageUrl} alt={title} className="max-h-[180px] w-full object-contain" />
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 px-3 py-3 sm:px-6 sm:py-5">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.10)]">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/90 px-4 py-3 text-xs text-slate-500">
            <span>Draw your solution naturally, then submit it to the public solve thread.</span>
            <span className="hidden sm:inline">Submitted canvases are view-only for everyone else.</span>
          </div>
          <div className="min-h-0 flex-1 bg-white">
            <LessonStyledExcalidraw
              key={sceneRef.current.updatedAt || 'composer'}
              className="h-full"
              initialData={buildInitialData(sceneRef.current)}
              UIOptions={editorUiOptions}
              zenModeEnabled={false}
              gridModeEnabled={false}
              onChange={(elements: any[], appState: any, files: any) => {
                const nextScene: PublicSolveScene = {
                  elements: cloneScenePart(Array.isArray(elements) ? elements : []),
                  appState: appState && typeof appState === 'object' ? cloneScenePart(appState) : undefined,
                  files: files && typeof files === 'object' ? cloneScenePart(files) : undefined,
                  updatedAt: new Date().toISOString(),
                }
                sceneRef.current = nextScene
                setHasContent(publicSolveSceneHasContent(nextScene))
              }}
              excalidrawAPI={(api: any) => {
                excalidrawApiRef.current = api
                if (!isReady) setIsReady(true)
              }}
              renderTopRightUI={() => null}
            />
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white/92 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-slate-500">
            {hasContent ? 'Ready to submit your solve.' : 'Add something to the canvas before submitting.'}
          </div>
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center rounded-full bg-[#1877f2] px-5 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(24,119,242,0.28)] transition hover:bg-[#176ad8] disabled:cursor-not-allowed disabled:opacity-55"
            onClick={() => onSubmit(sceneRef.current)}
            disabled={!isReady || !hasContent || submitting}
          >
            {submitting ? 'Submitting...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}