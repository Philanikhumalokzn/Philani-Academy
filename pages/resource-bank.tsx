import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { gradeToLabel, GRADE_VALUES, GradeValue, normalizeGradeInput } from '../lib/grades'

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
  createdBy?: { id: string; name?: string | null; email?: string | null; avatar?: string | null } | null
  parsedAt?: string | null
  parseError?: string | null
}

type ParsedPdfResult = {
  kind: 'pdf'
  version: 1
  resourceId: string
  extractedAt: string
  pages: Array<{
    pageNumber: number
    width: number
    height: number
    lines: Array<{ text: string; bbox: { x: number; y: number; w: number; h: number } }>
    diagrams: Array<{ url: string; bbox: { x: number; y: number; w: number; h: number } }>
  }>
  questions: Array<{ index: number; label: string; pageNumber: number; startLine: number; endLine: number; text: string }>
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
  const [parseAfterUpload, setParseAfterUpload] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const [parsedOpenId, setParsedOpenId] = useState<string | null>(null)
  const [parsedLoadingId, setParsedLoadingId] = useState<string | null>(null)
  const [parsedError, setParsedError] = useState<string | null>(null)
  const [parsedById, setParsedById] = useState<Record<string, { parsedAt: string | null; parseError: string | null; parsedJson: ParsedPdfResult | null }>>({})

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

  const isPdfFile = (file: File | null) => {
    if (!file) return false
    const name = (file.name || '').toLowerCase()
    return file.type === 'application/pdf' || name.endsWith('.pdf')
  }

  const looksLikePdfItem = (item: ResourceBankItem) => {
    const ct = String(item.contentType || '').toLowerCase()
    const fn = String(item.filename || '').toLowerCase()
    const url = String(item.url || '').toLowerCase()
    return ct.includes('pdf') || fn.endsWith('.pdf') || url.includes('.pdf')
  }

  const openParsedPanel = async (id: string) => {
    const safeId = String(id || '')
    if (!safeId) return

    if (parsedOpenId === safeId) {
      setParsedOpenId(null)
      return
    }

    setParsedOpenId(safeId)
    setParsedError(null)
    if (parsedById[safeId]) return

    setParsedLoadingId(safeId)
    try {
      const res = await fetch(`/api/resources/${encodeURIComponent(safeId)}`, { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to load parsed resource (${res.status})`)

      const parsedJson = (data?.parsedJson && typeof data.parsedJson === 'object') ? (data.parsedJson as ParsedPdfResult) : null
      setParsedById(prev => ({
        ...prev,
        [safeId]: {
          parsedAt: data?.parsedAt ? String(data.parsedAt) : null,
          parseError: data?.parseError ? String(data.parseError) : null,
          parsedJson,
        }
      }))
    } catch (err: any) {
      setParsedError(err?.message || 'Failed to load parsed resource')
    } finally {
      setParsedLoadingId(null)
    }
  }

  const handleUpload = async () => {
    if (status !== 'authenticated') return
    if (!effectiveGrade) {
      setError('Grade not configured for this account')
      return
    }

    const file = selectedFile || fileInputRef.current?.files?.[0] || null
    if (!file) {
      setError('Choose a file first')
      return
    }

    const shouldParse = parseAfterUpload && isPdfFile(file)

    setUploading(true)
    setError(null)

    try {
      const form = new FormData()
      form.append('file', file)
      if (title.trim()) form.append('title', title.trim())
      if (tag.trim()) form.append('tag', tag.trim())
      if (role === 'admin') form.append('grade', effectiveGrade)

      const res = await fetch('/api/resources', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Upload failed (${res.status})`)

      if (shouldParse && data?.id) {
        try {
          const parseRes = await fetch(`/api/resources/${encodeURIComponent(String(data.id))}/parse`, {
            method: 'POST',
            credentials: 'same-origin',
          })
          if (!parseRes.ok) {
            const parseData = await parseRes.json().catch(() => ({}))
            throw new Error(parseData?.message || `Parse failed (${parseRes.status})`)
          }
        } catch (parseErr: any) {
          setError(parseErr?.message || 'Failed to parse resource')
        }
      }

      setTitle('')
      setTag('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      setSelectedFile(null)

      await fetchItems(effectiveGrade)
    } catch (err: any) {
      setError(err?.message || 'Failed to upload resource')
    } finally {
      setUploading(false)
    }
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
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="input"
                    onChange={(e) => setSelectedFile(e.currentTarget.files?.[0] ?? null)}
                  />
                  <label className="flex items-center gap-2 text-xs muted">
                    <input
                      type="checkbox"
                      checked={parseAfterUpload}
                      onChange={(e) => setParseAfterUpload(e.target.checked)}
                      disabled={uploading || !isPdfFile(selectedFile)}
                    />
                    Parse after upload (PDF only)
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
                      <li key={item.id} className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-white truncate">{item.title}</div>
                            <div className="text-xs muted">
                              {item.tag ? `${item.tag} • ` : ''}
                              {gradeToLabel(item.grade)}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {looksLikePdfItem(item) ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => void openParsedPanel(item.id)}
                              >
                                {parsedOpenId === item.id ? 'Hide parsed' : 'View parsed'}
                              </button>
                            ) : null}
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-ghost"
                            >
                              Open
                            </a>
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
                        </div>

                        {parsedOpenId === item.id ? (
                          <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
                            {parsedError ? <div className="text-sm text-red-200">{parsedError}</div> : null}
                            {parsedLoadingId === item.id ? (
                              <div className="text-sm muted">Loading parsed view…</div>
                            ) : (
                              (() => {
                                const payload = parsedById[item.id]
                                if (!payload) return <div className="text-sm muted">No parsed data loaded.</div>
                                if (payload.parseError) return <div className="text-sm text-red-200">{payload.parseError}</div>
                                if (!payload.parsedJson) return <div className="text-sm muted">Not parsed yet (or parser output missing).</div>

                                const parsed = payload.parsedJson

                                return (
                                  <div className="space-y-4">
                                    <div className="text-xs muted">
                                      Parsed: {payload.parsedAt ? new Date(payload.parsedAt).toLocaleString() : '—'} • {parsed.pages.length} pages • {parsed.questions.length} questions
                                    </div>

                                    {parsed.questions.length ? (
                                      <div className="space-y-2">
                                        <div className="text-sm font-semibold text-white">Questions</div>
                                        <ul className="space-y-2">
                                          {parsed.questions.slice(0, 25).map((q) => (
                                            <li key={q.index} className="rounded-lg border border-white/10 bg-white/5 p-2">
                                              <div className="text-xs muted">{q.label} • Page {q.pageNumber}</div>
                                              <div className="text-sm text-white whitespace-pre-line">{q.text}</div>
                                            </li>
                                          ))}
                                        </ul>
                                        {parsed.questions.length > 25 ? (
                                          <div className="text-xs muted">Showing first 25 questions.</div>
                                        ) : null}
                                      </div>
                                    ) : null}

                                    <div className="space-y-4">
                                      <div className="text-sm font-semibold text-white">Pages</div>
                                      {parsed.pages.map((p) => (
                                        <div key={p.pageNumber} className="space-y-2">
                                          <div className="text-xs muted">Page {p.pageNumber}</div>

                                          {/* Diagram-only positioning preview */}
                                          <div
                                            className="w-full rounded-lg border border-white/10 bg-white/5 overflow-hidden"
                                            style={{ position: 'relative', paddingTop: `${(p.height / Math.max(1, p.width)) * 100}%` }}
                                          >
                                            {p.diagrams.map((d, idx) => (
                                              // eslint-disable-next-line @next/next/no-img-element
                                              <img
                                                key={idx}
                                                src={d.url}
                                                alt={`Diagram ${idx + 1}`}
                                                style={{
                                                  position: 'absolute',
                                                  left: `${d.bbox.x * 100}%`,
                                                  top: `${d.bbox.y * 100}%`,
                                                  width: `${d.bbox.w * 100}%`,
                                                  height: `${d.bbox.h * 100}%`,
                                                  objectFit: 'contain',
                                                }}
                                              />
                                            ))}
                                          </div>

                                          <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                                            <div className="text-xs muted mb-1">Extracted text</div>
                                            <div className="text-sm text-white whitespace-pre-line">
                                              {p.lines.map(l => l.text).join('\n')}
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )
                              })()
                            )}
                          </div>
                        ) : null}
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
