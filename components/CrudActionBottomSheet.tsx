import BottomSheet from './BottomSheet'

type Props = {
  open: boolean
  title: string
  subtitle: string
  editLabel: string
  editDescription: string
  deleteLabel: string
  deleteDescription: string
  disableEdit?: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}

export default function CrudActionBottomSheet({
  open,
  title,
  subtitle,
  editLabel,
  editDescription,
  deleteLabel,
  deleteDescription,
  disableEdit = false,
  onClose,
  onEdit,
  onDelete,
}: Props) {
  if (!open) return null

  return (
    <BottomSheet
      open
      backdrop
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      zIndexClassName="z-[69]"
      className="bottom-0"
      sheetClassName="rounded-t-[28px] rounded-b-none border-x-0 border-b-0 border-t border-slate-200 bg-[linear-gradient(180deg,#fbfcff_0%,#f0f6ff_100%)] shadow-[0_-18px_40px_rgba(15,23,42,0.14)]"
      contentClassName="px-4 pb-[calc(var(--app-safe-bottom)+1rem)] pt-2 sm:px-5 sm:pb-5"
    >
      <div className="space-y-2">
        <button
          type="button"
          className="philani-gradient-outline-soft [--philani-outline-fill:#f8fafc] flex w-full items-center justify-between rounded-2xl px-4 py-4 text-left text-slate-800 transition hover:brightness-[1.02] disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onEdit}
          disabled={disableEdit}
        >
          <span>
            <span className="block text-sm font-semibold">{editLabel}</span>
            <span className="block text-xs text-slate-500">{editDescription}</span>
          </span>
          <span className="text-slate-400">{'>'}</span>
        </button>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-left text-rose-700 transition hover:border-rose-300 hover:bg-rose-100"
          onClick={onDelete}
        >
          <span>
            <span className="block text-sm font-semibold">{deleteLabel}</span>
            <span className="block text-xs text-rose-500">{deleteDescription}</span>
          </span>
          <span className="text-rose-300">{'>'}</span>
        </button>
      </div>
    </BottomSheet>
  )
}