import Link from 'next/link'

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
    <main className="min-h-screen p-8 bg-slate-50">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold mb-2">Privacy Notice</h1>
          <p className="text-sm text-slate-600">Updated 22 November 2025</p>
        </header>

        <section className="card p-6 space-y-4">
          <p>
            Philani Academy complies with the Protection of Personal Information Act (POPIA). This notice explains what learner
            information we collect during enrolment and how we use it to deliver our educational services.
          </p>
          <p>
            By creating an account or updating your profile you consent to the processing of the categories of personal information described below.
            You can withdraw consent or request corrections at any time by contacting <a className="text-blue-600" href="mailto:support@philaniacademy.org">support@philaniacademy.org</a>.
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
          <p>You may request access, corrections or deletion by emailing <a className="text-blue-600" href="mailto:support@philaniacademy.org">support@philaniacademy.org</a>.</p>
        </section>

        <footer className="text-sm text-slate-600 space-y-1">
          <p>Need to adjust your information? Visit your <Link className="text-blue-600" href="/profile">profile</Link> at any time.</p>
          <p>Questions or POPIA requests? Email <a className="text-blue-600" href="mailto:support@philaniacademy.org">support@philaniacademy.org</a>.</p>
        </footer>
      </div>
    </main>
  )
}
