import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { signIn, useSession } from 'next-auth/react'
import BrandLogo from './BrandLogo'
import JitsiRoom from './JitsiRoom'
import { gradeToLabel, normalizeGradeInput } from '../lib/grades'
import type { Session } from 'next-auth'

const CanvasOverlay = dynamic(() => import('./CanvasOverlay'), { ssr: false })

function normalizeError(error?: string | null) {
  if (!error) return null
  if (error === 'CredentialsSignin') return 'Invalid email or password.'
  return error
}

type SignInScreenProps = {
  title?: string
}

export default function SignInScreen({ title = 'Sign in | Philani Academy' }: SignInScreenProps) {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resendStatus, setResendStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [lastOtpEmail, setLastOtpEmail] = useState<string | null>(null)

  const callbackUrl = typeof router.query.callbackUrl === 'string' ? router.query.callbackUrl : '/dashboard'

  useEffect(() => {
    const incomingError = normalizeError(typeof router.query.error === 'string' ? router.query.error : null)
    if (incomingError) {
      setError(incomingError)
    }
  }, [router.query.error])

  const handleSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setInfo(null)

    const result = await signIn('credentials', {
      redirect: false,
      email,
      password,
      callbackUrl
    })

    setLoading(false)

    if (result?.error) {
      setError(normalizeError(result.error))
      return
    }

    if (result?.url) {
      await router.push(result.url)
      return
    }

    await router.push('/dashboard')
  }, [email, password, callbackUrl, router])

  const handleResend = useCallback(async () => {
    if (!email) {
      setError('Enter your email first so we know where to send the code.')
      return
    }

    setResendStatus('loading')
    setError(null)
    setInfo(null)

    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.message || 'Could not send verification email.')
      }
      setResendStatus('sent')
      setInfo(data?.message || 'Check your inbox for the new verification code.')
      setLastOtpEmail(email)
      router.push({ pathname: '/verify-email', query: { email } })
    } catch (err: any) {
      setResendStatus('error')
      setError(err?.message || 'Something went wrong. Please try again later.')
    }
  }, [email, router])

  if (status === 'authenticated' && session) {
    return (
      <>
        <Head>
          <title>Live class | Philani Academy</title>
        </Head>
        <MobileLiveShell session={session} />
      </>
    )
  }

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <div className="deep-page min-h-screen flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full bg-white text-slate-900 shadow-md rounded-3xl p-8">
          <div className="space-y-3 mb-6 text-center">
            <div className="flex justify-center">
              <BrandLogo height={64} />
            </div>
            <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Philani Academy</p>
            <h1 className="text-3xl font-semibold text-slate-900">Sign in</h1>
            <p className="text-sm text-slate-600">Welcome back! Enter your credentials to access the dashboard.</p>
          </div>

          {error && <div className="mb-4 rounded-md bg-red-100 p-3 text-sm text-red-700">{error}</div>}
          {info && <div className="mb-4 rounded-md bg-green-100 p-3 text-sm text-green-700">{info}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-900">Email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="input input-light mt-1"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-900">Password</label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                className="input input-light mt-1"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 space-y-4 text-sm text-slate-600">
            <p>
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="text-primary hover:underline font-medium">
                Sign up
              </Link>
            </p>

            <div className="border-t border-slate-200 pt-4">
              <p className="font-medium text-slate-900 mb-2">Email verification</p>
              <p className="mb-3">
                If you created an account earlier and have not verified your email, request a new code below.
              </p>
              <button
                type="button"
                className="btn btn-ghost w-full border-slate-300 text-slate-900 font-medium hover:bg-slate-100 disabled:opacity-50"
                onClick={handleResend}
                disabled={resendStatus === 'loading'}
              >
                {resendStatus === 'loading' ? 'Sending…' : 'Resend verification code'}
              </button>
              {resendStatus === 'sent' && (
                <p className="mt-2 text-sm text-green-700">Check your inbox for the latest verification code.</p>
              )}
              {resendStatus === 'error' && (
                <p className="mt-2 text-sm text-red-600">We could not send the email. Please try again later.</p>
              )}
              {lastOtpEmail && (
                <p className="mt-1 text-xs text-slate-500 text-center">Last verification attempt sent to <span className="font-medium text-slate-900">{lastOtpEmail}</span></p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

type MobileLiveShellProps = {
  session: Session
}

type MobileShellUser = Session['user'] & {
  grade?: string
  role?: string
  id?: string
}

function MobileLiveShell({ session }: MobileLiveShellProps) {
  const router = useRouter()
  const [canvasOpen, setCanvasOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const shellUser = session.user as MobileShellUser
  const gradeValue = normalizeGradeInput(shellUser?.grade)
  const gradeLabel = gradeValue ? gradeToLabel(gradeValue) : 'Unassigned'
  const gradeSlug = useMemo(() => (gradeValue ? gradeValue.toLowerCase().replace(/_/g, '-') : null), [gradeValue])
  const gradeRoomName = useMemo(() => {
    const appId = process.env.NEXT_PUBLIC_JAAS_APP_ID || ''
    const baseSlug = gradeSlug ?? 'public-room'
    const base = `philani-${baseSlug}`
    return appId ? `${appId}/${base}` : base
  }, [gradeSlug])
  const boardRoomId = useMemo(() => (gradeSlug ? `myscript-grade-${gradeSlug}` : 'myscript-grade-public'), [gradeSlug])
  const gradeTokenEndpoint = gradeValue ? `/api/sessions/grade/${gradeValue}/token` : null
  const displayName = shellUser?.name || shellUser?.email || 'Participant'
  const userId = shellUser?.id || shellUser?.email || 'guest'
  const isAdmin = shellUser?.role === 'admin'
  const canLaunchCanvas = Boolean(gradeValue)

  return (
    <div className="mobile-live-shell min-h-screen flex items-center justify-center px-4 py-8 overflow-hidden">
      <div className="live-shell-card">
        <header className="live-shell-card__header">
          <BrandLogo height={48} className="drop-shadow-lg" />
          <button type="button" className="master-menu-button" onClick={() => setMenuOpen(true)} aria-label="Open master menu">
            <span />
            <span />
            <span />
          </button>
        </header>
        <div className="live-shell-call" role="region" aria-label="Live class">
          {canLaunchCanvas ? (
            <JitsiRoom
              roomName={gradeRoomName}
              displayName={displayName}
              sessionId={null}
              tokenEndpoint={gradeTokenEndpoint}
              passwordEndpoint={null}
              isOwner={isAdmin}
            />
          ) : (
            <div className="live-shell-call__placeholder">
              <p className="text-[13px] uppercase tracking-[0.3em] text-white/60">Awaiting grade</p>
              <p className="text-white text-lg font-semibold">Ask your instructor to assign a grade before joining the live class.</p>
            </div>
          )}
          {canLaunchCanvas && (
            <button
              type="button"
              className="live-shell-canvas-button"
              onClick={() => setCanvasOpen(true)}
            >
              Canvas
            </button>
          )}
        </div>
        <footer className="live-shell-card__footer">
          <div>
            <p className="live-shell-card__eyebrow">Signed in</p>
            <p className="live-shell-card__value">{session.user?.email}</p>
          </div>
          <div>
            <p className="live-shell-card__eyebrow">Grade</p>
            <p className="live-shell-card__value">{gradeLabel}</p>
          </div>
          <div>
            <p className="live-shell-card__eyebrow">Status</p>
            <p className="live-shell-card__value">{canLaunchCanvas ? 'Ready' : 'Awaiting assignment'}</p>
          </div>
        </footer>
      </div>

      <CanvasOverlay
        isOpen={canvasOpen && canLaunchCanvas}
        onClose={() => setCanvasOpen(false)}
        gradeLabel={gradeLabel}
        roomId={boardRoomId}
        userId={userId}
        userDisplayName={displayName}
        isAdmin={isAdmin}
      />

      <MobileMasterMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        session={session}
        gradeLabel={gradeLabel}
        onNavigate={(href) => {
          router.push(href)
          setMenuOpen(false)
        }}
      />
    </div>
  )
}

type MobileMasterMenuProps = {
  open: boolean
  onClose: () => void
  session: Session
  gradeLabel: string
  onNavigate: (href: string) => void
}

function MobileMasterMenu({ open, onClose, session, gradeLabel, onNavigate }: MobileMasterMenuProps) {
  const menuActions = [
    { label: 'Announcements', description: 'Communicate updates', href: '/dashboard?section=announcements' },
    { label: 'Sessions', description: 'Schedule classes & materials', href: '/dashboard?section=sessions' },
    { label: 'Billing', description: 'Subscription plans', href: '/dashboard?section=billing' },
    { label: 'Account', description: 'Profile settings', href: '/profile' }
  ]

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!open) return null

  return (
    <div className="master-menu-overlay" role="dialog" aria-modal="true">
      <div className="master-menu-overlay__backdrop" onClick={onClose} />
      <div className="master-menu-overlay__panel">
        <div className="master-menu-overlay__header">
          <div>
            <p className="text-[11px] uppercase tracking-[0.35em] text-white/70">Master menu</p>
            <h2 className="text-white text-2xl font-semibold">Your hub</h2>
          </div>
          <button type="button" className="master-menu-overlay__close" onClick={onClose}>
            Close
          </button>
        </div>

        <section className="master-menu-section">
          <p className="master-menu-section__title">Account snapshot</p>
          <dl className="master-menu-section__grid">
            <div>
              <dt>Email</dt>
              <dd>{session.user?.email}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{(session.user as any)?.role || 'student'}</dd>
            </div>
            <div>
              <dt>Grade</dt>
              <dd>{gradeLabel}</dd>
            </div>
          </dl>
          <div className="master-menu-section__actions">
            <button type="button" onClick={() => onNavigate('/profile')}>
              Update profile
            </button>
            <button type="button" onClick={() => onNavigate('/subscribe')}>
              Manage subscription
            </button>
          </div>
        </section>

        <section className="master-menu-section">
          <p className="master-menu-section__title">Quick actions</p>
          <div className="master-menu-actions">
            {menuActions.map(action => (
              <button key={action.label} type="button" onClick={() => onNavigate(action.href)}>
                <span className="master-menu-actions__label">{action.label}</span>
                <span className="master-menu-actions__description">{action.description}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
