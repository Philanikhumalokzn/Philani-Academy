import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 md:p-8">
      <div className="max-w-4xl w-full grid grid-cols-1 gap-6 items-stretch md:grid-cols-2 md:gap-8">
        <section className="hero fade-up flex flex-col justify-center h-full">
          <div className="md:pr-6">
            <h1>Philani Academy for Mathematics</h1>
            <p className="muted mt-2">Central hub for registrations, subscriptions and session links. Manage classes, enrollments and redirect learners to live sessions on Teams, Padlet or Zoom.</p>
            <div className="mt-4 flex flex-col gap-3 md:flex-row md:gap-3">
              <Link href="/signup" className="btn btn-primary w-full md:w-auto">Get started</Link>
              <Link href="/dashboard" className="btn btn-ghost w-full md:w-auto">Dashboard</Link>
            </div>
          </div>
        </section>

        <aside className="card float md:order-last md:w-full flex flex-col justify-center h-full">
          <div>
            <h3 className="font-bold">Why Philani?</h3>
            <ul className="mt-3 space-y-2 text-sm muted">
              <li>Easy signups and centralized admin</li>
              <li>Seamless session redirects to your preferred tools</li>
              <li>Subscription-ready — Stripe integration planned</li>
            </ul>
            <div className="mt-4">
              <span className="tag">Mathematics</span>
            </div>
          </div>
        </aside>
      </div>
    </main>
  )
}
