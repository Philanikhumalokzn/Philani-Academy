type BrandLogoProps = {
  height?: number
  className?: string
  label?: boolean
  labelClassName?: string
}

export default function BrandLogo({ height = 40, className = '', label = false, labelClassName = 'text-white text-sm font-semibold tracking-[0.3em] uppercase' }: BrandLogoProps) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <img
        src="/philani-logo.png"
        alt="Philani Academy logo"
        style={{ height, width: 'auto', display: 'block' }}
      />
      {label && <span className={labelClassName}>Philani Academy</span>}
    </span>
  )
}
