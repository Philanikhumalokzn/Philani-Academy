import Link from 'next/link'
import type { ReactNode } from 'react'

export default function UserLink({
  userId,
  className,
  children,
  title,
}: {
  userId: string | null | undefined
  className?: string
  children: ReactNode
  title?: string
}) {
  const id = typeof userId === 'string' ? userId.trim() : ''
  if (!id) return <span className={className} title={title}>{children}</span>
  return (
    <Link
      href={`/u/${encodeURIComponent(id)}`}
      className={className}
      title={title}
    >
      {children}
    </Link>
  )
}
