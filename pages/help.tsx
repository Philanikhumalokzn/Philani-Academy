import Link from 'next/link'

import NavArrows from '../components/NavArrows'

const helpItems = [
  {
    title: 'Account help',
    description: 'Update profile details, grade placement, or verification information from your profile page.'
  },
  {
    title: 'Classes and learning',
    description: 'Use the dashboard to join sessions, open learning resources, and access class-related tasks.'
  },
  {
    title: 'Billing and access',
    description: 'Subscription and plan issues can be reviewed from the subscription and billing areas of the platform.'
  }
]

export default function HelpPage() {
  return (
    <main className="deep-page min-h-screen px-4 py-8 md:py-12">
      <div className="mx-auto max-w-4xl space-y-8">
        <section className="hero flex-col gap-6">
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <NavArrows backHref="/dashboard" forwardHref="/privacy" />
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="board-chip">Help</span>
              <span className="board-chip">Support</span>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-[12px] uppercase tracking-[0.35em] text-blue-200">Help</p>
            <h1 className="text-3xl font-semibold md:text-4xl">Get support quickly</h1>
            <p className="text-sm text-white md:text-base">
              For account, learning, or access issues, start with the links below or contact support directly.
            </p>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white">
            <p className="text-xs uppercase tracking-[0.25em] text-blue-200">Support email</p>
            <p className="mt-2 font-semibold text-white">support@philaniacademy.org</p>
            <p className="mt-1 text-white/80">For help, contact us at any time.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white">
            <p className="text-xs uppercase tracking-[0.25em] text-blue-200">Quick links</p>
            <p className="mt-2 font-semibold text-white"><Link className="text-blue-200 underline" href="/profile">Profile</Link></p>
            <p className="mt-1 text-white/80">Review account details and access.</p>
          </div>
        </div>

        <section className="card p-6 space-y-4">
          <h2 className="text-xl font-semibold">Common support areas</h2>
          <ul className="list-disc list-inside space-y-3 text-sm text-white">
            {helpItems.map(item => (
              <li key={item.title}>
                <span className="font-medium">{item.title}:</span> {item.description}
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-6 space-y-3 text-sm text-white">
          <h2 className="text-xl font-semibold">Policies</h2>
          <p>Review the <Link className="text-blue-200 underline" href="/privacy">privacy notice</Link> and <Link className="text-blue-200 underline" href="/terms">terms and conditions</Link> for the legal and service rules that apply to your account.</p>
        </section>
      </div>
    </main>
  )
}