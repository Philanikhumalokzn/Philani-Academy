import CrudActionBottomSheet from './CrudActionBottomSheet'

type Props = {
  open: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}

export default function PostCrudBottomSheet({
  open,
  onClose,
  onEdit,
  onDelete,
}: Props) {
  return (
    <CrudActionBottomSheet
      open={open}
      title="Post options"
      subtitle="Press and hold your post to open these actions"
      editLabel="Edit post"
      editDescription="Open your existing post for editing."
      deleteLabel="Delete post"
      deleteDescription="Remove this post permanently."
      onClose={onClose}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  )
}