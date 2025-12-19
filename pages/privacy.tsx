import Link from 'next/link'

import NavArrows from '../components/NavArrows'

const privacyItems = [
  {
    title: 'Identity information',
    description: 'First name, last name, other names, date of birth and optional South African ID number are required to register learners and meet examination board requirements.'
  },
  {
    title: 'Academic profile',
    description: 'We store your current grade placement and the school or institution you are enrolled with so that we can deliver the correct learning materials.'
  },
  {
    title: 'Contact details',
    description: 'Primary and recovery email addresses, primary mobile number and optional alternate mobile number allow us to communicate about classes, billing and service updates.'
  },
  {
    title: 'Emergency contact',
    description: 'Guardian or parent name, relationship and mobile number ensure we can reach a responsible adult in urgent situations.'
  },
  {
    title: 'Residential address',
    description: 'Street address, city, province, postal code and country are used for enrolment compliance, reporting and regional programme planning.'
  },
  {
    title: 'Consent record',
    description: 'We store your POPIA consent flag and timestamp to demonstrate compliance with personal information regulations.'
  }
]

export default function PrivacyNotice() {
  return (
    <main className="deep-page min-h-screen px-2 py-8 md:py-12">
      <div className="w-full space-y-8">
        <section className="hero flex-col gap-6">
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <NavArrows backHref="/dashboard" forwardHref="/subscribe" />
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="board-chip">Updated 22 Nov 2025</span>
              <span className="board-chip">POPIA compliant</span>
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-[12px] uppercase tracking-[0.35em] text-blue-200">Privacy notice</p>
            <h1 className="text-3xl font-semibold md:text-4xl">How we protect learner information</h1>
            <p className="text-sm text-white md:text-base">
              This page mirrors the deep-blue hero treatment everywhere else, so you always know you&apos;re still inside Philani Academy when reviewing your data rights.
            </p>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white">
            <p className="text-xs uppercase tracking-[0.25em] text-blue-200">Contact</p>
            <p className="mt-2 font-semibold text-white">support@philaniacademy.org</p>
            <p className="text-white">Use this address for POPIA requests, updates, or withdrawal of consent.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white">
            <p className="text-xs uppercase tracking-[0.25em] text-blue-200">Actions</p>
            <p className="mt-2 font-semibold text-white">Visit your <Link className="text-blue-200 underline" href="/profile">profile</Link></p>
            <p className="text-white">Update details anytime to keep examination records accurate.</p>
          </div>
        </div>

        <section className="card p-6 space-y-4">
          <p>
            Philani Academy complies with the Protection of Personal Information Act (POPIA). This notice explains what learner
            information we collect during enrolment and how we use it to deliver our educational services.
          </p>
          <p>
            By creating an account or updating your profile you consent to the processing of the categories of personal information described below.
            You can withdraw consent or request corrections at any time by contacting <a className="text-blue-200" href="mailto:support@philaniacademy.org">support@philaniacademy.org</a>.
          </p>
        </section>

        <section className="card p-6 space-y-4">
          <h2 className="text-xl font-semibold">What we collect and why</h2>
          <ul className="space-y-3 list-disc list-inside text-sm">
            {privacyItems.map(item => (
              <li key={item.title}>
                <span className="font-medium">{item.title}:</span> {item.description}
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-6 space-y-3 text-sm">
          <h2 className="text-xl font-semibold">How we protect your information</h2>
          <p>Personal information is stored in our secured hosted database. Access is limited to authorised staff who require it to support learners.</p>
          <p>We retain learner information only while providing educational services and for the minimum period required by law or accreditation bodies.</p>
          <p>You may request access, corrections or deletion by emailing <a className="text-blue-200 underline" href="mailto:support@philaniacademy.org">support@philaniacademy.org</a>.</p>
        </section>

        <footer className="space-y-1 text-sm text-white">
          <p>
            Need to adjust your information? Visit your <Link className="text-blue-200" href="/profile">profile</Link> at any time.
          </p>
          <p>
            Questions or POPIA requests? Email <a className="text-blue-200" href="mailto:support@philaniacademy.org">support@philaniacademy.org</a>.
          </p>
        </footer>
      </div>
    </main>
  )
}
