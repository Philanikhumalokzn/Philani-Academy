import React from 'react'

export type SessionPresenterAvatar = {
	kind: 'presenter' | 'attendee'
	userKey: string
	initials: string
	name: string
	clientId?: string
	userId?: string
}

type SessionPresenterStripProps = {
	visible: boolean
	teacherBadge: { name: string; initials: string } | null
	topAvatars: SessionPresenterAvatar[]
	bottomAvatars: SessionPresenterAvatar[]
	teacherAvatarGold: boolean
	showSwitchingToast: boolean
	switchingStatusLabel: string
	handoffMessage: string | null
	isAdmin: boolean
	isAvatarEditingAuthority: (userKey?: string | null) => boolean
	onTeacherClick?: React.MouseEventHandler<HTMLButtonElement>
	onAvatarClick?: React.MouseEventHandler<HTMLButtonElement>
}

export default function SessionPresenterStrip({
	visible,
	teacherBadge,
	topAvatars,
	bottomAvatars,
	teacherAvatarGold,
	showSwitchingToast,
	switchingStatusLabel,
	handoffMessage,
	isAdmin,
	isAvatarEditingAuthority,
	onTeacherClick,
	onAvatarClick,
}: SessionPresenterStripProps) {
	if (!visible || !teacherBadge) return null

	return (
		<div
			className="fixed"
			style={{
				top: '50%',
				left: 'calc(env(safe-area-inset-left, 0px) + 1rem)',
				transform: 'translateY(-50%)',
				zIndex: 2147483647,
			}}
		>
			<div className="relative w-6">
				{topAvatars.length > 0 ? (
					<div className="absolute left-0 bottom-[calc(100%+6px)] flex flex-col-reverse items-start gap-1.5">
						{topAvatars.map((avatar) => (
							avatar.kind === 'presenter' ? (
								<div
									key={avatar.userKey}
									className={`w-6 h-6 rounded-full text-white text-[10px] font-semibold flex items-center justify-center border shadow-sm ${isAvatarEditingAuthority(avatar.userKey) ? 'bg-amber-500 border-amber-700 ring-2 ring-amber-200' : 'bg-slate-700 border-white/60'}`}
									title={`${avatar.name} (presenter)`}
									aria-label={`${avatar.name} is a presenter`}
								>
									{avatar.initials}
								</div>
							) : (
								<button
									type="button"
									key={avatar.userKey}
									data-client-id={avatar.clientId || ''}
									data-user-id={avatar.userId || ''}
									data-user-key={avatar.userKey}
									data-display-name={avatar.name}
									className={`w-6 h-6 rounded-full text-white text-[10px] font-semibold flex items-center justify-center border shadow-sm ${isAvatarEditingAuthority(avatar.userKey) ? 'bg-amber-500 border-amber-700 ring-2 ring-amber-200' : 'bg-slate-700 border-white/60'}`}
									title={avatar.name}
									aria-label={`Make ${avatar.name} the presenter`}
									onClick={onAvatarClick}
									onPointerDown={(e) => {
										e.stopPropagation()
									}}
								>
									{avatar.initials}
								</button>
							)
						))}
					</div>
				) : null}

				<button
					type="button"
					className={`w-6 h-6 rounded-full text-white text-[10px] font-semibold flex items-center justify-center border shadow-sm ${teacherAvatarGold ? 'bg-amber-500 border-amber-700 ring-2 ring-amber-200' : 'bg-slate-900 border-white/60'}`}
					onClick={onTeacherClick}
					onPointerDown={(e) => {
						if (!isAdmin) return
						e.stopPropagation()
					}}
					aria-label={isAdmin ? 'Toggle session avatars' : undefined}
					title={teacherBadge.name}
					style={{ pointerEvents: isAdmin ? 'auto' : 'none' }}
				>
					{teacherBadge.initials}
				</button>

				{showSwitchingToast ? (
					<div
						className="absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 shadow-sm"
						style={{ zIndex: 2147483647 }}
						role="status"
						aria-live="polite"
					>
						{switchingStatusLabel}
					</div>
				) : null}

				{!showSwitchingToast && handoffMessage ? (
					<div
						className="absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 max-w-[170px] rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 shadow-sm"
						style={{ zIndex: 2147483647 }}
						role="alert"
					>
						{handoffMessage}
					</div>
				) : null}

				{bottomAvatars.length > 0 ? (
					<div className="absolute left-0 top-[calc(100%+6px)] flex flex-col items-start gap-1.5">
						{bottomAvatars.map((avatar) => (
							avatar.kind === 'presenter' ? (
								<div
									key={avatar.userKey}
									className={`w-6 h-6 rounded-full text-white text-[10px] font-semibold flex items-center justify-center border shadow-sm ${isAvatarEditingAuthority(avatar.userKey) ? 'bg-amber-500 border-amber-700 ring-2 ring-amber-200' : 'bg-slate-700 border-white/60'}`}
									title={`${avatar.name} (presenter)`}
									aria-label={`${avatar.name} is a presenter`}
								>
									{avatar.initials}
								</div>
							) : (
								<button
									type="button"
									key={avatar.userKey}
									data-client-id={avatar.clientId || ''}
									data-user-id={avatar.userId || ''}
									data-user-key={avatar.userKey}
									data-display-name={avatar.name}
									className={`w-6 h-6 rounded-full text-white text-[10px] font-semibold flex items-center justify-center border shadow-sm ${isAvatarEditingAuthority(avatar.userKey) ? 'bg-amber-500 border-amber-700 ring-2 ring-amber-200' : 'bg-slate-700 border-white/60'}`}
									title={avatar.name}
									aria-label={`Make ${avatar.name} the presenter`}
									onClick={onAvatarClick}
									onPointerDown={(e) => {
										e.stopPropagation()
									}}
								>
									{avatar.initials}
								</button>
							)
						))}
					</div>
				) : null}
			</div>
		</div>
	)
}
