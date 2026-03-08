import React from 'react'

type SessionChromePillProps = {
	children: React.ReactNode
	className?: string
	style?: React.CSSProperties
	onPointerDown?: React.PointerEventHandler<HTMLDivElement>
}

export default function SessionChromePill({ children, className, style, onPointerDown }: SessionChromePillProps) {
	return (
		<div
			className={`inline-flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/92 px-2 py-1.5 text-slate-800 shadow-sm backdrop-blur-sm ${className || ''}`.trim()}
			style={style}
			onPointerDown={onPointerDown}
		>
			{children}
		</div>
	)
}
