import Link from 'next/link'

type AppFooterProps = {
  tone?: 'dark' | 'light'
  className?: string
}

export default function AppFooter({ tone = 'dark', className = '' }: AppFooterProps) {
  const currentYear = new Date().getFullYear()
  const isDark = tone === 'dark'

  const shellClass = isDark
    ? 'rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] px-5 py-4 text-white shadow-[0_16px_45px_rgba(2,6,23,0.24)] backdrop-blur-xl'
    : 'rounded-[24px] border border-black/10 bg-white px-4 py-4 text-[#1c1e21] shadow-[0_10px_28px_rgba(15,23,42,0.06)]'

  const linkClass = isDark
    ? 'text-white/72 transition hover:text-white'
    : 'text-[#5b6574] transition hover:text-[#1c1e21]'

  const metaClass = isDark ? 'text-white/55' : 'text-[#6b7280]'

  return (
    <footer className={`${shellClass} ${className}`.trim()}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] font-medium">
        <Link href="/privacy" className={linkClass}>Privacy</Link>
        <Link href="/terms" className={linkClass}>Terms</Link>
        <Link href="/help" className={linkClass}>Help</Link>
        <a href="mailto:support@philaniacademy.org" className={linkClass}>Contact</a>
      </div>
      <div className={`mt-3 text-[12px] leading-5 ${metaClass}`}>
        Educational platform. Use of the service is subject to platform policies and applicable law.
      </div>
      <div className={`mt-1 text-[12px] ${metaClass}`}>
        © {currentYear} Philani Academy. All rights reserved.
      </div>
    </footer>
  )
}