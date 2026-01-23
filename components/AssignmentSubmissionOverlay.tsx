import React from 'react'
import FullScreenGlassOverlay from './FullScreenGlassOverlay'

type GradingEntry = {
  earnedMarks?: number | string | null
  totalMarks?: number | string | null
  stepFeedback?: any[]
}

export type AssignmentSubmissionOverlayProps = {
  mode: 'admin' | 'learner'

  title: string
  subtitle?: string

  onClose: () => void
  onBackdropClick?: () => void

  showRegradeButton?: boolean
  regradeLoading?: boolean
  onRegrade?: () => void

  errors?: Array<string | null | undefined>

  meta?: React.ReactNode

  loading?: boolean
  loadingText?: string
  emptyState?: React.ReactNode

  questions: any[]
  responsesByQuestionId: Record<string, any>
  gradingByQuestionId?: Record<string, GradingEntry>

  responseLabel: string
  emptyResponseText: string
  openFirstQuestion?: boolean

  renderTextWithKatex: (text: string) => React.ReactNode
  renderKatexDisplayHtml: (latex: string) => string
  splitLatexIntoSteps: (latex: string) => string[]
}

export default function AssignmentSubmissionOverlay(props: AssignmentSubmissionOverlayProps) {
  const {
    mode,
    title,
    subtitle,
    onClose,
    onBackdropClick,
    showRegradeButton,
    regradeLoading,
    onRegrade,
    errors,
    meta,
    loading,
    loadingText,
    emptyState,
    questions,
    responsesByQuestionId,
    gradingByQuestionId,
    responseLabel,
    emptyResponseText,
    openFirstQuestion,
    renderTextWithKatex,
    renderKatexDisplayHtml,
    splitLatexIntoSteps
  } = props

  const handleBackdropClick = onBackdropClick || onClose

  const normalizedErrors = (errors || []).filter(Boolean).map(String)

  const renderResponseBlock = (qid: string, respLatex: string, stepFeedback: any[]) => {
    if (!respLatex.trim()) {
      return <div className={mode === 'admin' ? 'text-sm text-white/60' : 'text-sm text-white/70'}>{emptyResponseText}</div>
    }

    const steps = splitLatexIntoSteps(respLatex)

    if (Array.isArray(stepFeedback) && stepFeedback.length && steps.length) {
      const byStep = new Map<number, any>()
      for (const s of stepFeedback) {
        const idx2 = Number(s?.step ?? s?.index ?? s?.stepIndex ?? 0)
        if (Number.isFinite(idx2) && idx2 > 0) byStep.set(Math.trunc(idx2), s)
      }

      return (
        <div className="space-y-2">
          {steps.map((stepLatex: string, i: number) => {
            const stepNum = i + 1
            const fb = byStep.get(stepNum)
            const awarded = Number(fb?.awardedMarks ?? fb?.awarded ?? fb?.marks ?? 0)
            const awardedInt = Number.isFinite(awarded) ? Math.max(0, Math.trunc(awarded)) : 0

            const explicitIsCorrect = (typeof fb?.isCorrect === 'boolean') ? Boolean(fb.isCorrect) : null
            const isCorrect = (explicitIsCorrect == null) ? (awardedInt > 0) : explicitIsCorrect
            const isSignificant = (typeof fb?.isSignificant === 'boolean') ? Boolean(fb.isSignificant) : (!isCorrect)
            const feedbackText = String(fb?.feedback ?? fb?.note ?? fb?.why ?? fb?.correctStep ?? '').trim()

            const html = renderKatexDisplayHtml(stepLatex)
            const inner = html
              ? (
                <div
                  className={(isCorrect ? '' : 'underline decoration-red-300') + ' min-w-max text-sm leading-relaxed text-white/90 [&_.katex]:text-sm [&_.katex-display]:text-sm'}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ) : (
                <div className={(isCorrect ? '' : 'underline decoration-red-300 ') + 'min-w-max text-sm leading-relaxed text-white/90 font-mono whitespace-pre'}>
                  {stepLatex}
                </div>
              )
            const line = <div className="overflow-x-auto max-w-full">{inner}</div>

            return (
              <div key={`${qid}-${mode}-step-${stepNum}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
                <div className="min-w-0">{line}</div>
                <div className="shrink-0 justify-self-end self-start flex items-center gap-2">
                  {awardedInt > 0 ? (
                    <span
                      className="text-green-200 flex items-center"
                      aria-label={`${awardedInt} mark${awardedInt === 1 ? '' : 's'} earned`}
                      title={`${awardedInt} mark${awardedInt === 1 ? '' : 's'}`}
                    >
                      {Array.from({ length: Math.min(awardedInt, 12) }).map((_, j) => (
                        <svg key={`tick-${qid}-${mode}-${stepNum}-${j}`} viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                          <path
                            d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.12 7.18a1 1 0 0 1-1.42.006L3.29 9.01a1 1 0 1 1 1.414-1.414l3.17 3.17 6.412-6.47a1 1 0 0 1 1.418-.006z"
                            fill="currentColor"
                          />
                        </svg>
                      ))}
                      {awardedInt > 12 ? (
                        <span className="text-xs text-white/70 ml-1">+{awardedInt - 12}</span>
                      ) : null}
                    </span>
                  ) : isCorrect ? (
                    <span className="text-green-200" aria-label="Correct but 0 marks" title="Correct but 0 marks">
                      <svg viewBox="0 0 10 10" className="w-2 h-2" aria-hidden="true">
                        <circle cx="5" cy="5" r="4" fill="currentColor" />
                      </svg>
                    </span>
                  ) : (
                    isSignificant ? (
                      <span className="text-red-200" aria-label="Incorrect significant step" title="Incorrect (significant)">
                        <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                          <path
                            d="M6.293 6.293a1 1 0 0 1 1.414 0L10 8.586l2.293-2.293a1 1 0 1 1 1.414 1.414L11.414 10l2.293 2.293a1 1 0 0 1-1.414 1.414L10 11.414l-2.293 2.293a1 1 0 0 1-1.414-1.414L8.586 10 6.293 7.707a1 1 0 0 1 0-1.414z"
                            fill="currentColor"
                          />
                        </svg>
                      </span>
                    ) : (
                      <span className="text-red-200" aria-label="Incorrect insignificant step" title="Incorrect (insignificant)">
                        <svg viewBox="0 0 10 10" className="w-2 h-2" aria-hidden="true">
                          <circle cx="5" cy="5" r="4" fill="currentColor" />
                        </svg>
                      </span>
                    )
                  )}
                </div>

                {!isCorrect && awardedInt === 0 ? (
                  <div className="text-xs text-white/70 max-w-full whitespace-pre-wrap break-words">
                    {(feedbackText || 'Check this step').slice(0, 160)}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )
    }

    if (steps.length > 1) {
      return (
        <div className="space-y-2">
          {steps.map((stepLatex: string, i: number) => {
            const html = renderKatexDisplayHtml(stepLatex)
            const inner = html ? (
              <div
                className="min-w-max text-sm leading-relaxed text-white/90 [&_.katex]:text-sm [&_.katex-display]:text-sm"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <div className="min-w-max text-sm leading-relaxed text-white/90 font-mono whitespace-pre">{stepLatex}</div>
            )
            return (
              <div key={`${qid}-${mode}-step-plain-${i}`} className="overflow-x-auto max-w-full">{inner}</div>
            )
          })}
        </div>
      )
    }

    const html = renderKatexDisplayHtml(respLatex)
    if (html) {
      return mode === 'admin' ? (
        <div className="overflow-x-auto max-w-full">
          <div
            className="min-w-max text-sm leading-relaxed text-white/90 [&_.katex]:text-sm [&_.katex-display]:text-sm"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      ) : (
        <div
          className="text-sm text-white/90 [&_.katex]:text-sm [&_.katex-display]:text-sm"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )
    }

    return mode === 'admin'
      ? (
        <div className="overflow-x-auto max-w-full">
          <div className="min-w-max text-sm leading-relaxed text-white/90 font-mono whitespace-pre">{respLatex}</div>
        </div>
      )
      : <div className="text-sm text-white/90 whitespace-pre-wrap break-words">{renderTextWithKatex(respLatex)}</div>
  }

  return (
    <FullScreenGlassOverlay
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      onBackdropClick={handleBackdropClick}
      rightActions={showRegradeButton ? (
        <button
          type="button"
          className="px-4 py-2 rounded-full border border-white/15 bg-white/15 hover:bg-white/20 text-white text-xs font-semibold whitespace-nowrap disabled:opacity-60"
          disabled={Boolean(regradeLoading)}
          onClick={() => onRegrade?.()}
        >
          {regradeLoading ? 'Re-grading…' : 'Re-grade'}
        </button>
      ) : null}
    >
      {normalizedErrors.map((e, idx) => (
        <div key={`overlay-err-${idx}`} className="text-sm text-red-200 mb-3">{e}</div>
      ))}

      {meta ? <div className="mb-4">{meta}</div> : null}

      {loading ? (
        <div className="text-sm text-white/70">{String(loadingText || 'Loading…')}</div>
      ) : (
        (() => {
          if (!Array.isArray(questions) || !questions.length) return emptyState || <div className="text-sm text-white/70">No questions found.</div>

          return (
            <div className="space-y-3">
              {questions.map((q: any, idx: number) => {
                const qid = String(q?.id || '')
                const respLatex = qid ? String(responsesByQuestionId?.[qid]?.latex || '') : ''
                const grade = qid ? gradingByQuestionId?.[qid] : undefined

                const earnedMarks = (typeof grade?.earnedMarks === 'number' || typeof grade?.earnedMarks === 'string') ? Number(grade.earnedMarks) : undefined
                const totalMarks = (typeof grade?.totalMarks === 'number' || typeof grade?.totalMarks === 'string') ? Number(grade.totalMarks) : undefined
                const stepFeedback = Array.isArray(grade?.stepFeedback) ? grade?.stepFeedback : []

                return (
                  <details
                    key={`${mode}-sub-q-${qid || idx}`}
                    className="border border-white/10 rounded-lg bg-white/5 overflow-hidden"
                    open={Boolean(openFirstQuestion && idx === 0)}
                  >
                    <summary className="cursor-pointer px-3 py-2 font-medium text-sm text-white flex items-center justify-between gap-2">
                      <span className="truncate">Question {idx + 1}</span>
                      {typeof earnedMarks === 'number' && typeof totalMarks === 'number' ? (
                        <span className={Number(earnedMarks) > 0 ? 'text-green-200' : 'text-red-200'}>(
                          {Math.trunc(Number(earnedMarks))}/{Math.trunc(Number(totalMarks))}
                        )</span>
                      ) : null}
                    </summary>

                    <div className="px-3 pb-3">
                      <div className="pt-2 text-sm text-white/90 whitespace-pre-wrap break-words [&_.katex]:text-sm [&_.katex-display]:text-sm">
                        {renderTextWithKatex(String(q?.latex || ''))}
                      </div>

                      <div className="pt-3 space-y-2">
                        <div className="text-xs text-white/70">{responseLabel}</div>
                        {renderResponseBlock(qid, respLatex, stepFeedback)}
                      </div>
                    </div>
                  </details>
                )
              })}
            </div>
          )
        })()
      )}
    </FullScreenGlassOverlay>
  )
}
