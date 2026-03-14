import Link from 'next/link'

import NavArrows from '../components/NavArrows'

const termItems = [
  {
    title: 'Use of the platform',
    description: 'Philani Academy is provided for learning, class participation, communication, and approved school-related collaboration.'
  },
  {
    title: 'Accounts and access',
    description: 'Users are responsible for accurate account information, keeping credentials secure, and using only authorised workspaces.'
  },
  {
    title: 'Content and conduct',
    description: 'Posts, messages, assignments, and uploads must remain lawful, respectful, and relevant to educational use.'
  },
  {
    title: 'Billing and service',
    description: 'Paid services, subscriptions, and access controls are governed by the plan selected and may change with notice where required.'
  }
]

export default function TermsPage() {
  return (
    <main className="deep-page min-h-screen px-4 py-8 md:py-12">
      <div className="mx-auto max-w-4xl space-y-8">
        <section className="hero flex-col gap-6">
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <NavArrows backHref="/dashboard" forwardHref="/help" />
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="board-chip">Updated Mar 2026</span>
              <span className="board-chip">Platform terms</span>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-[12px] uppercase tracking-[0.35em] text-blue-200">Terms and conditions</p>
            <h1 className="text-3xl font-semibold md:text-4xl">Simple rules for using Philani Academy</h1>
            <p className="text-sm text-white md:text-base">
              These terms outline acceptable use, account responsibilities, and the basic conditions that apply when you use the platform.
            </p>
          </div>
        </section>

        <section className="card p-6 space-y-4 text-sm text-white">
          <p>
            By accessing or using Philani Academy, you agree to follow these terms, our <Link className="text-blue-200 underline" href="/privacy">privacy notice</Link>,
            and any classroom or subscription rules that apply to your account.
          </p>
          <p>
            If you do not agree with these conditions, please stop using the service and contact <a className="text-blue-200 underline" href="mailto:support@philaniacademy.org">support@philaniacademy.org</a>.
          </p>
        </section>

        <section className="card p-6 space-y-4">
          <h2 className="text-xl font-semibold">Core terms</h2>
          <ul className="list-disc list-inside space-y-3 text-sm text-white">
            {termItems.map(item => (
              <li key={item.title}>
                <span className="font-medium">{item.title}:</span> {item.description}
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-6 space-y-3 text-sm text-white">
          <h2 className="text-xl font-semibold">Disclaimer</h2>
          <p>Learning content is provided as educational support and should be reviewed alongside teacher guidance, classroom instruction, and school requirements where applicable.</p>
          <p>We may update features, access levels, or policies as the service evolves. Continued use after updates means the revised terms apply.</p>
        </section>

        <footer className="space-y-1 text-sm text-white">
          <p>Need help? Visit the <Link className="text-blue-200" href="/help">help page</Link> or email <a className="text-blue-200" href="mailto:support@philaniacademy.org">support@philaniacademy.org</a>.</p>
        </footer>
      </div>
    </main>
  )
}