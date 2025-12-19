import Link from 'next/link';

export default function NavArrows({ backHref, forwardHref, className = '' }) {
  return (
    <div className={`flex justify-between items-center w-full mt-4 mb-2 px-2 ${className}`}>
      <div>
        {backHref ? (
          <Link href={backHref} className="inline-flex items-center gap-1 text-blue-700 hover:underline">
            <span aria-hidden="true">←</span> Back
          </Link>
        ) : <span />}
      </div>
      <div>
        {forwardHref ? (
          <Link href={forwardHref} className="inline-flex items-center gap-1 text-blue-700 hover:underline">
            Next <span aria-hidden="true">→</span>
          </Link>
        ) : <span />}
      </div>
    </div>
  );
}
