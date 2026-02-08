export const toDisplayFileName = (value: string | null | undefined): string => {
  const raw = String(value || '').trim()
  if (!raw) return ''

  const cleaned = raw.split('?')[0].split('#')[0]
  const base = cleaned.replace(/\\/g, '/').split('/').pop() || cleaned
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return base

  const ext = base.slice(dot + 1)
  if (ext.length < 2 || ext.length > 6) return base
  if (!/^[a-z0-9]+$/i.test(ext)) return base

  return base.slice(0, dot)
}
