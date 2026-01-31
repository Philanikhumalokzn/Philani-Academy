import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { gradeToLabel, GRADE_VALUES, GradeValue, normalizeGradeInput } from '../lib/grades'
import FullScreenGlassOverlay from '../components/FullScreenGlassOverlay'
import ParsedDocumentViewer from '../components/ParsedDocumentViewer'
import PdfViewerOverlay from '../components/PdfViewerOverlay'

type ResourceBankItem = {
  id: string
  grade: GradeValue
  title: string
  tag?: string | null
  url: string
  filename?: string | null
  contentType?: string | null
  size?: number | null
  checksum?: string | null
  source?: string | null
  createdById?: string | null
  createdAt: string
  parsedAt?: string | null
  parseError?: string | null
  createdBy?: { id: string; name?: string | null; email?: string | null; avatar?: string | null } | null
}

export default function ResourceBankPage() {
  const { status, data: session } = useSession()
  const role = ((session as any)?.user?.role as string | undefined) || 'student'

  const [profile, setProfile] = useState<any>(null)
  const [profileLoading, setProfileLoading] = useState(false)

  const [selectedGrade, setSelectedGrade] = useState<GradeValue | ''>('')
  const [items, setItems] = useState<ResourceBankItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [tag, setTag] = useState('')
  const [uploading, setUploading] = useState(false)
  const [parseOnUpload, setParseOnUpload] = useState(false)
  const [aiNormalizeOnUpload, setAiNormalizeOnUpload] = useState(false)

  const [parsedViewerOpen, setParsedViewerOpen] = useState(false)
  const [parsedViewerLoading, setParsedViewerLoading] = useState(false)
  const [parsedViewerTitle, setParsedViewerTitle] = useState('')
  const [parsedViewerText, setParsedViewerText] = useState('')
  const [parsedViewerJson, setParsedViewerJson] = useState<any | null>(null)

  const [parseDebugOpen, setParseDebugOpen] = useState(false)
  const [parseDebugItem, setParseDebugItem] = useState<ResourceBankItem | null>(null)

  const [pdfViewerOpen, setPdfViewerOpen] = useState(false)
  const [pdfViewerUrl, setPdfViewerUrl] = useState('')
  const [pdfViewerTitle, setPdfViewerTitle] = useState('')
  const [pdfViewerSubtitle, setPdfViewerSubtitle] = useState('')

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const effectiveGrade: GradeValue | undefined = useMemo(() => {
    const profileGrade = normalizeGradeInput(profile?.grade)
    if (role === 'admin') {
      return normalizeGradeInput(selectedGrade) || profileGrade
    }
    return profileGrade
  }, [profile?.grade, role, selectedGrade])

  const effectiveGradeLabel = useMemo(() => gradeToLabel(effectiveGrade || null), [effectiveGrade])

  useEffect(() => {
    if (status !== 'authenticated') return
    let cancelled = false
    setProfileLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/profile', { credentials: 'same-origin' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.message || `Failed to load profile (${res.status})`)
        if (!cancelled) setProfile(data)
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load profile')
      } finally {
        if (!cancelled) setProfileLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [status])

  const fetchItems = async (grade: GradeValue | undefined) => {
    if (!grade) {
      setItems([])
      return
    }

    setLoading(true)
    setError(null)
    try {
      const url = role === 'admin' ? `/api/resources?grade=${encodeURIComponent(grade)}` : '/api/resources'
      const res = await fetch(url, { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to load resources (${res.status})`)
      const nextItems = Array.isArray(data?.items) ? data.items : []
      setItems(nextItems)
    } catch (err: any) {
      setError(err?.message || 'Failed to load resources')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (status !== 'authenticated') return
    void fetchItems(effectiveGrade)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, effectiveGrade, role])

  const canDelete = (item: ResourceBankItem) => {
    if (role === 'admin') return true
    const myId = String(profile?.id || '')
    return Boolean(myId && item.createdById && String(item.createdById) === myId)
  }

  const handleUpload = async () => {
    if (status !== 'authenticated') return
    if (!effectiveGrade) {
      setError('Grade not configured for this account')
      return
    }

    const file = fileInputRef.current?.files?.[0]
    if (!file) {
      setError('Choose a file first')
      return
    }

    setUploading(true)
    setError(null)

    try {
      const form = new FormData()
      form.append('file', file)
      if (title.trim()) form.append('title', title.trim())
      if (tag.trim()) form.append('tag', tag.trim())
      if (role === 'admin') form.append('grade', effectiveGrade)
      if (parseOnUpload) form.append('parse', '1')
      if (parseOnUpload && aiNormalizeOnUpload) form.append('aiNormalize', '1')

      const res = await fetch('/api/resources', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Upload failed (${res.status})`)

      if (parseOnUpload && typeof data?.parseError === 'string' && data.parseError.trim()) {
        setError(`Parse failed: ${data.parseError}`)
      }

      setTitle('')
      setTag('')
      if (fileInputRef.current) fileInputRef.current.value = ''

      await fetchItems(effectiveGrade)
    } catch (err: any) {
      setError(err?.message || 'Failed to upload resource')
    } finally {
      setUploading(false)
    }
  }

  const openParsedViewer = async (item: ResourceBankItem) => {
    const id = String(item?.id || '')
    if (!id) return
    setParsedViewerOpen(true)
    setParsedViewerLoading(true)
    setParsedViewerTitle(item?.title || 'Parsed')
    setParsedViewerText('')
    setParsedViewerJson(null)
    try {
      const res = await fetch(`/api/resources/${encodeURIComponent(id)}/parsed`, { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to load parsed data (${res.status})`)

      const json = data?.parsedJson
      const err = typeof data?.parseError === 'string' ? data.parseError : ''
      if (json && typeof json === 'object') {
        setParsedViewerJson(json)
      } else {
        const rendered = err || 'No parsed output available.'
        setParsedViewerText(rendered)
      }
    } catch (err: any) {
      setParsedViewerText(err?.message || 'Failed to load parsed output')
    } finally {
      setParsedViewerLoading(false)
    }
  }

  const openParseDebug = (item: ResourceBankItem) => {
    setParseDebugItem(item)
    setParseDebugOpen(true)
  }

  const isPdfResource = (item: ResourceBankItem) => {
    const filename = (item.filename || '').toLowerCase()
    const url = (item.url || '').toLowerCase()
    const contentType = (item.contentType || '').toLowerCase()
    return contentType.includes('application/pdf') || filename.endsWith('.pdf') || url.includes('.pdf')
  }

  const openPdfViewer = (item: ResourceBankItem) => {
    setPdfViewerTitle(item.title || 'Document')
    // Avoid showing filepaths/URLs in the UI.
    setPdfViewerSubtitle('')
    setPdfViewerUrl(item.url)
    setPdfViewerOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!id) return
    setError(null)
    try {
      const res = await fetch(`/api/resources/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message || `Delete failed (${res.status})`)
      }
      await fetchItems(effectiveGrade)
    } catch (err: any) {
      setError(err?.message || 'Failed to delete resource')
    }
  }

  return (
    <main className="deep-page min-h-screen pb-16">
      <div className="max-w-6xl mx-auto px-4 lg:px-8 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-white">Resource Bank</h1>
            <p className="text-sm muted">All shared learning resources for your class.</p>
          </div>
          <Link href="/dashboard" className="btn btn-ghost shrink-0">Back</Link>
        </div>

        {status !== 'authenticated' ? (
          <div className="card dashboard-card space-y-3">
            <div className="text-sm text-white">Sign in to view your grade resources.</div>
            <Link href="/api/auth/signin" className="btn btn-primary w-fit">Sign in</Link>
          </div>
        ) : (
          <>
            {pdfViewerOpen ? (
              <PdfViewerOverlay
                open={pdfViewerOpen}
                url={pdfViewerUrl}
                title={pdfViewerTitle}
                subtitle={pdfViewerSubtitle || undefined}
                onClose={() => setPdfViewerOpen(false)}
              />
            ) : null}

            {parseDebugOpen ? (
              <FullScreenGlassOverlay
                title="Parsing debugger"
                subtitle={parseDebugItem?.title || 'Resource'}
                zIndexClassName="z-50"
                onClose={() => setParseDebugOpen(false)}
              >
                <div className="rounded-2xl border border-white/15 bg-white/90 p-4 text-slate-900 space-y-3">
                  <div className="text-sm">
                    <div><span className="font-semibold">Filename:</span> {parseDebugItem?.filename || '—'}</div>
                    <div><span className="font-semibold">Content type:</span> {parseDebugItem?.contentType || '—'}</div>
                    <div><span className="font-semibold">Size:</span> {typeof parseDebugItem?.size === 'number' ? `${Math.round(parseDebugItem.size / 1024)} KB` : '—'}</div>
                    <div><span className="font-semibold">Parsed at:</span> {parseDebugItem?.parsedAt ? new Date(parseDebugItem.parsedAt).toLocaleString() : '—'}</div>
                  </div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Error details</div>
                  <pre className="whitespace-pre-wrap break-words rounded-xl bg-slate-100 p-3 text-xs text-slate-900">
                    {parseDebugItem?.parseError || 'No error details available.'}
                  </pre>
                </div>
              </FullScreenGlassOverlay>
            ) : null}

            {parsedViewerOpen ? (
              <FullScreenGlassOverlay
                title="Parsed"
                subtitle={parsedViewerTitle}
                zIndexClassName="z-50"
                onClose={() => setParsedViewerOpen(false)}
              >
                {parsedViewerLoading ? <div className="text-sm muted">Loading…</div> : null}
                {!parsedViewerLoading && (
                  <ParsedDocumentViewer parsedJson={parsedViewerJson} fallbackText={parsedViewerText} />
                )}
              </FullScreenGlassOverlay>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="card dashboard-card space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-white">Your workspace</div>
                    <div className="text-sm muted">{profileLoading ? 'Loading…' : effectiveGradeLabel}</div>
                  </div>
                  {role === 'admin' ? (
                    <div className="space-y-1">
                      <div className="text-xs muted">Grade</div>
                      <select
                        className="input"
                        value={selectedGrade}
                        onChange={(e) => setSelectedGrade(normalizeGradeInput(e.target.value) || '')}
                      >
                        <option value="">(My grade)</option>
                        {GRADE_VALUES.map((g) => (
                          <option key={g} value={g}>{gradeToLabel(g)}</option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <div className="text-xs muted">Title</div>
                    <input
                      className="input"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Algebra worksheet"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs muted">Tag</div>
                    <input
                      className="input"
                      value={tag}
                      onChange={(e) => setTag(e.target.value)}
                      placeholder="e.g. Past paper"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs muted">File</div>
                  <input ref={fileInputRef} type="file" className="input" />
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-white/90 select-none">
                      <input
                        type="checkbox"
                        checked={parseOnUpload}
                        onChange={(e) => {
                          const next = e.target.checked
                          setParseOnUpload(next)
                          if (!next) setAiNormalizeOnUpload(false)
                        }}
                      />
                      Parse (Mathpix OCR)
                    </label>
                    <label className={`flex items-center gap-2 text-sm ${parseOnUpload ? 'text-white/90' : 'text-white/40'} select-none`}>
                      <input
                        type="checkbox"
                        checked={aiNormalizeOnUpload}
                        onChange={(e) => setAiNormalizeOnUpload(e.target.checked)}
                        disabled={!parseOnUpload}
                      />
                      AI post-normalize (Gemini)
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary w-fit"
                      onClick={() => void handleUpload()}
                      disabled={uploading || profileLoading || !effectiveGrade}
                    >
                      {uploading ? 'Uploading…' : 'Upload'}
                    </button>
                  </div>
                </div>

                <p className="text-xs muted">Uploads are restricted to your registered grade (admin can choose).</p>
              </div>

              <div className="card dashboard-card space-y-3">
                <div className="text-lg font-semibold text-white">Resources</div>
                {error ? <div className="text-sm text-red-200">{error}</div> : null}
                {loading ? <div className="text-sm muted">Loading…</div> : null}

                {!loading && items.length === 0 ? (
                  <div className="text-sm muted">No resources yet.</div>
                ) : null}

                {items.length > 0 ? (
                  <ul className="space-y-2">
                    {items.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="min-w-0">
                          <div className="font-medium text-white truncate">{item.title}</div>
                          <div className="text-xs muted">
                            {item.tag ? `${item.tag} • ` : ''}
                            {gradeToLabel(item.grade)}
                          </div>
                          {item.parseError ? (
                            <button
                              type="button"
                              className="text-left text-xs text-red-200 underline decoration-dotted"
                              onClick={() => openParseDebug(item)}
                            >
                              Parse failed — view details
                            </button>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {isPdfResource(item) ? (
                            <button type="button" className="btn btn-ghost" onClick={() => openPdfViewer(item)}>
                              View
                            </button>
                          ) : (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-ghost"
                            >
                              Open
                            </a>
                          )}
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-ghost"
                          >
                            Open new
                          </a>
                          {item.parsedAt || item.parseError ? (
                            <button type="button" className="btn btn-ghost" onClick={() => void openParsedViewer(item)}>
                              View parsed
                            </button>
                          ) : null}
                          {canDelete(item) ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => void handleDelete(item.id)}
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
