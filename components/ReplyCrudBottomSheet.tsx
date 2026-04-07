import CrudActionBottomSheet from './CrudActionBottomSheet'

type Props = {
  open: boolean
  disableEdit?: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}

export default function ReplyCrudBottomSheet({
  open,
  disableEdit = false,
  onClose,
  onEdit,
  onDelete,
}: Props) {
  return (
    <CrudActionBottomSheet
      open={open}
      title="Reply options"
      subtitle="Press and hold your reply to open these actions"
      editLabel="Edit reply"
      editDescription="Open your existing reply for editing."
      deleteLabel="Delete reply"
      deleteDescription="Remove this reply permanently."
      disableEdit={disableEdit}
      onClose={onClose}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  )
}