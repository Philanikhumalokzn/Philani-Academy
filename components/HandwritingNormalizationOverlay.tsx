import FullScreenGlassOverlay from './FullScreenGlassOverlay'
import HandwritingNormalizationTestCanvas from './HandwritingNormalizationTestCanvas'

type HandwritingNormalizationOverlayProps = {
  open: boolean
  onClose: () => void
}

export default function HandwritingNormalizationOverlay({ open, onClose }: HandwritingNormalizationOverlayProps) {
  if (!open) return null

  return (
    <FullScreenGlassOverlay
      title="Handwriting Normalization Lab"
      subtitle="Rule-based ink grouping, graph scoring, structural role inference, and normalization preview"
      onClose={onClose}
      onBackdropClick={onClose}
      zIndexClassName="z-[68]"
      panelSize="full"
      contentClassName="pt-0 px-3 pb-[calc(0.35rem+var(--app-safe-bottom))] sm:px-4 sm:pb-[calc(0.8rem+var(--app-safe-bottom))]"
      rightActions={
        <span className="rounded-full border border-[#78b8ff]/30 bg-[#0a2447] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#dbeafe]">
          Admin tool
        </span>
      }
    >
      <HandwritingNormalizationTestCanvas />
    </FullScreenGlassOverlay>
  )
}