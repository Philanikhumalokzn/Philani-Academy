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
      sheetClassName="rounded-t-[28px] rounded-b-none border-x-0 border-b-0 border-t border-slate-200 bg-white shadow-[0_-18px_40px_rgba(15,23,42,0.14)]"
      contentClassName="px-4 pb-[calc(var(--app-safe-bottom)+1rem)] pt-2 sm:px-5 sm:pb-5"
    >
      <div className="space-y-2">
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-slate-800 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
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
          className="flex w-full items-center justify-between rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-left text-red-700 transition hover:border-red-300 hover:bg-red-100"
          onClick={onDelete}
        >
          <span>
            <span className="block text-sm font-semibold">{deleteLabel}</span>
            <span className="block text-xs text-red-500">{deleteDescription}</span>
          </span>
          <span className="text-red-300">{'>'}</span>
        </button>
      </div>
    </BottomSheet>
  )
}