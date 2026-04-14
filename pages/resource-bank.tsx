import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { upload } from '@vercel/blob/client'
import { gradeToLabel, GRADE_VALUES, GradeValue, normalizeGradeInput } from '../lib/grades'
import { toDisplayFileName } from '../lib/fileName'
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
  parsedJson?: any | null
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
  const [convertDocxOnUpload, setConvertDocxOnUpload] = useState(false)

  const [parsedViewerOpen, setParsedViewerOpen] = useState(false)
  const [parsedViewerLoading, setParsedViewerLoading] = useState(false)
  const [parsedViewerTitle, setParsedViewerTitle] = useState('')
  const [parsedViewerText, setParsedViewerText] = useState('')
  const [parsedViewerJson, setParsedViewerJson] = useState<any | null>(null)
  const [parsedDownloadBusy, setParsedDownloadBusy] = useState(false)

  const [parseDebugOpen, setParseDebugOpen] = useState(false)
  const [parseDebugItem, setParseDebugItem] = useState<ResourceBankItem | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editItem, setEditItem] = useState<ResourceBankItem | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editTag, setEditTag] = useState('')
  const [editGrade, setEditGrade] = useState<GradeValue | ''>('')
  const [editParse, setEditParse] = useState(false)
  const [editAiNormalize, setEditAiNormalize] = useState(false)
  const [editing, setEditing] = useState(false)

  // Extract questions overlay
  const [extractOpen, setExtractOpen] = useState(false)
  const [extractItem, setExtractItem] = useState<ResourceBankItem | null>(null)
  const [extractYear, setExtractYear] = useState(new Date().getFullYear())
  const [extractMonth, setExtractMonth] = useState('November')
  const [extractPaper, setExtractPaper] = useState(1)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [extractResult, setExtractResult] = useState<{ created: number; skipped: number } | null>(null)

  // Review questions overlay
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewItem, setReviewItem] = useState<ResourceBankItem | null>(null)
  const [reviewQuestions, setReviewQuestions] = useState<any[]>([])
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [savingQId, setSavingQId] = useState<string | null>(null)
  const [deletingQId, setDeletingQId] = useState<string | null>(null)

  const [pdfViewerOpen, setPdfViewerOpen] = useState(false)
  const [pdfViewerUrl, setPdfViewerUrl] = useState('')
  const [pdfViewerCacheKey, setPdfViewerCacheKey] = useState('')
  const [pdfViewerTitle, setPdfViewerTitle] = useState('')
  const [pdfViewerSubtitle, setPdfViewerSubtitle] = useState('')

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const buildResourceBlobPath = (grade: GradeValue, originalName: string) => {
    const safe = String(originalName || 'resource')
      .replace(/\\/g, '_')
      .replace(/\//g, '_')
      .replace(/[^a-z0-9._-]+/gi, '_')
      .slice(0, 120)
    const stamp = Date.now()
    return `resource-bank/${String(grade)}/${stamp}_${safe}`
  }

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
      // Vercel serverless functions have a small request payload limit (often ~4.5 MB).
      // Upload larger files directly to Vercel Blob from the browser.
      const shouldUseClientUpload = file.size > 4.0 * 1024 * 1024

      if (shouldUseClientUpload) {
        const blobPath = buildResourceBlobPath(effectiveGrade, file.name)

        let blob: any
        try {
          blob = await upload(blobPath, file, {
            access: 'public',
            handleUploadUrl: '/api/resources/blob-upload',
          })
        } catch (uploadErr: any) {
          const msg = uploadErr?.message || 'Direct upload failed'
          throw new Error(`${msg}. If you're running locally, ensure Vercel Blob is configured (BLOB_READ_WRITE_TOKEN).`)
        }

        const registerRes = await fetch('/api/resources/register', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: blob?.url,
            filename: blob?.pathname || blobPath,
            contentType: file.type || null,
            size: file.size,
            title: title.trim() ? title.trim() : undefined,
            tag: tag.trim() ? tag.trim() : undefined,
            grade: role === 'admin' ? effectiveGrade : undefined,
            parse: parseOnUpload ? '1' : undefined,
            aiNormalize: parseOnUpload && aiNormalizeOnUpload ? '1' : undefined,
            convertDocx: convertDocxOnUpload ? '1' : undefined,
          }),
        })

        const registerData = await registerRes.json().catch(() => ({}))
        if (!registerRes.ok) {
          throw new Error(registerData?.message || `Upload failed (${registerRes.status})`)
        }

        if (parseOnUpload && typeof registerData?.parseError === 'string' && registerData.parseError.trim()) {
          setError(`Parse failed: ${registerData.parseError}`)
        }

        setTitle('')
        setTag('')
        if (fileInputRef.current) fileInputRef.current.value = ''

        await fetchItems(effectiveGrade)
        return
      }

      const form = new FormData()
      form.append('file', file)
      if (title.trim()) form.append('title', title.trim())
      if (tag.trim()) form.append('tag', tag.trim())
      if (role === 'admin') form.append('grade', effectiveGrade)
      if (parseOnUpload) form.append('parse', '1')
      if (parseOnUpload && aiNormalizeOnUpload) form.append('aiNormalize', '1')
      if (convertDocxOnUpload) form.append('convertDocx', '1')

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
    setParsedViewerTitle(toDisplayFileName(item?.title) || item?.title || 'Parsed')
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

  const buildParsedDocxFilename = (title: string) => {
    const baseRaw = (title || 'parsed').toString().trim() || 'parsed'
    const base = baseRaw.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_') || 'parsed'
    return `${base}.docx`
  }

  const downloadParsedDocx = async () => {
    if (parsedDownloadBusy) return
    setParsedDownloadBusy(true)
    try {
      const mmd = typeof parsedViewerJson?.raw?.mmd === 'string'
        ? parsedViewerJson.raw.mmd
        : typeof parsedViewerJson?.text === 'string'
        ? parsedViewerJson.text
        : ''

      if (!mmd) throw new Error('No parsed content available to download.')

      const res = await fetch('/api/resources/convert-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mmd, title: parsedViewerTitle || 'parsed' }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message || `Failed to convert (${res.status})`)
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = buildParsedDocxFilename(parsedViewerTitle || 'parsed')
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err: any) {
      setError(err?.message || 'Failed to download parsed output')
    } finally {
      setParsedDownloadBusy(false)
    }
  }

  const buildLatexFilename = (item: ResourceBankItem) => {
    const baseRaw = (item?.title || item?.filename || 'resource').toString().trim() || 'resource'
    const base = baseRaw.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_') || 'resource'
    return `${base}.tex`
  }

  const extractLatexFromParsed = (parsed: any) => {
    if (!parsed || typeof parsed !== 'object') return ''
    const direct = typeof parsed?.latex === 'string' ? parsed.latex.trim() : ''
    if (direct) return direct
    const lines = Array.isArray(parsed?.lines) ? parsed.lines : []
    if (!lines.length) return ''
    const chunks = lines
      .map((line: any) => {
        if (!line || typeof line !== 'object') return ''
        return (typeof line.latex_styled === 'string' && line.latex_styled.trim())
          || (typeof line.latex_simplified === 'string' && line.latex_simplified.trim())
          || (typeof line.latex === 'string' && line.latex.trim())
          || ''
      })
      .filter(Boolean)
    return chunks.join('\n\n')
  }

  const handleDownloadLatex = async (item: ResourceBankItem) => {
    const id = String(item?.id || '')
    if (!id) return
    setError(null)
    try {
      const res = await fetch(`/api/resources/${encodeURIComponent(id)}/parsed`, { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to load parsed data (${res.status})`)

      const json = data?.parsedJson
      const latexText = extractLatexFromParsed(json)
      if (!latexText) {
        const err = typeof data?.parseError === 'string' ? data.parseError : ''
        throw new Error(err || 'No LaTeX output available for this resource')
      }

      const blob = new Blob([latexText], { type: 'application/x-tex;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = buildLatexFilename(item)
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err: any) {
      setError(err?.message || 'Failed to download LaTeX')
    }
  }
  const openParseDebug = (item: ResourceBankItem) => {
    setParseDebugItem(item)
    setParseDebugOpen(true)
  }

  const openExtract = (item: ResourceBankItem) => {
    setExtractItem(item)
    setExtractResult(null)
    setExtractError(null)
    setExtractOpen(true)
  }

  const handleExtract = async () => {
    if (!extractItem?.id) return
    setExtracting(true)
    setExtractError(null)
    setExtractResult(null)
    try {
      const res = await fetch('/api/resources/extract-questions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceId: extractItem.id,
          year: extractYear,
          month: extractMonth,
          paper: extractPaper,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Extraction failed (${res.status})`)
      setExtractResult({ created: data.created ?? 0, skipped: data.skipped ?? 0 })
    } catch (err: any) {
      setExtractError(err?.message || 'Extraction failed')
    } finally {
      setExtracting(false)
    }
  }

  const openReview = async (item: ResourceBankItem) => {
    setReviewItem(item)
    setReviewQuestions([])
    setReviewError(null)
    setReviewOpen(true)
    setReviewLoading(true)
    try {
      const res = await fetch(
        `/api/exam-questions?sourceId=${encodeURIComponent(item.id)}&take=200`,
        { credentials: 'same-origin' },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to load questions (${res.status})`)
      setReviewQuestions(Array.isArray(data?.items) ? data.items : [])
    } catch (err: any) {
      setReviewError(err?.message || 'Failed to load questions')
    } finally {
      setReviewLoading(false)
    }
  }

  const toggleApprove = async (qId: string, current: boolean) => {
    setSavingQId(qId)
    try {
      const res = await fetch(`/api/exam-questions/${encodeURIComponent(qId)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: !current }),
      })
      if (!res.ok) throw new Error('Failed to update')
      const updated = await res.json()
      setReviewQuestions((prev) =>
        prev.map((q) => (q.id === qId ? { ...q, approved: updated.approved } : q))
      )
    } catch {
      // silent — state stays unchanged
    } finally {
      setSavingQId(null)
    }
  }

  const deleteQuestion = async (qId: string) => {
    setDeletingQId(qId)
    try {
      const res = await fetch(`/api/exam-questions/${encodeURIComponent(qId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error('Failed to delete')
      setReviewQuestions((prev) => prev.filter((q) => q.id !== qId))
    } catch {
      // silent
    } finally {
      setDeletingQId(null)
    }
  }

  const openEdit = (item: ResourceBankItem) => {
    setEditItem(item)
    setEditTitle(item?.title || '')
    setEditTag(item?.tag || '')
    setEditGrade((item?.grade as GradeValue) || '')
    setEditParse(false)
    setEditAiNormalize(false)
    setEditOpen(true)
  }

  const saveEdit = async () => {
    if (!editItem?.id) return
    setEditing(true)
    setError(null)
    try {
      const res = await fetch(`/api/resources/${encodeURIComponent(editItem.id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          tag: editTag,
          grade: editGrade || undefined,
          parse: editParse ? '1' : undefined,
          aiNormalize: editParse && editAiNormalize ? '1' : undefined,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Edit failed (${res.status})`)

      setEditOpen(false)
      setEditItem(null)
      await fetchItems(effectiveGrade)
    } catch (err: any) {
      setError(err?.message || 'Failed to edit resource')
    } finally {
      setEditing(false)
    }
  }

  const isPdfResource = (item: ResourceBankItem) => {
    const filename = (item.filename || '').toLowerCase()
    const url = (item.url || '').toLowerCase()
    const contentType = (item.contentType || '').toLowerCase()
    return contentType.includes('application/pdf') || filename.endsWith('.pdf') || url.includes('.pdf')
  }

  const openPdfViewer = (item: ResourceBankItem) => {
    setPdfViewerTitle(toDisplayFileName(item.title) || item.title || 'Document')
    // Avoid showing filepaths/URLs in the UI.
    setPdfViewerSubtitle('')
    setPdfViewerUrl(item.url)
    setPdfViewerCacheKey(String(item.id || item.url || item.title || 'pdf'))
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
            {editOpen ? (
              <FullScreenGlassOverlay
                title="Edit resource"
                subtitle={toDisplayFileName(editItem?.title) || editItem?.title || 'Resource'}
                zIndexClassName="z-50"
                onClose={() => {
                  if (editing) return
                  setEditOpen(false)
                }}
              >
                <div className="rounded-2xl border border-white/15 bg-white/90 p-4 text-slate-900 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <div className="text-xs uppercase tracking-wide text-slate-600">Title</div>
                      <input className="input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs uppercase tracking-wide text-slate-600">Tag</div>
                      <input className="input" value={editTag} onChange={(e) => setEditTag(e.target.value)} />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs uppercase tracking-wide text-slate-600">Grade</div>
                    <select
                      className="input"
                      value={editGrade}
                      onChange={(e) => setEditGrade(normalizeGradeInput(e.target.value) || '')}
                    >
                      <option value="">(unchanged)</option>
                      {GRADE_VALUES.map((g) => (
                        <option key={g} value={g}>{gradeToLabel(g)}</option>
                      ))}
                    </select>
                    <div className="text-xs text-slate-600">Admin can move resources across grades.</div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-slate-900 select-none">
                      <input
                        type="checkbox"
                        checked={editParse}
                        onChange={(e) => {
                          const next = e.target.checked
                          setEditParse(next)
                          if (!next) setEditAiNormalize(false)
                        }}
                      />
                      Re-parse (Mathpix OCR)
                    </label>
                    <label className={`flex items-center gap-2 text-sm ${editParse ? 'text-slate-900' : 'text-slate-500'} select-none`}>
                      <input
                        type="checkbox"
                        checked={editAiNormalize}
                        onChange={(e) => setEditAiNormalize(e.target.checked)}
                        disabled={!editParse}
                      />
                      AI post-normalize (Gemini)
                    </label>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button type="button" className="btn btn-ghost" onClick={() => setEditOpen(false)} disabled={editing}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-primary" onClick={() => void saveEdit()} disabled={editing}>
                      {editing ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </FullScreenGlassOverlay>
            ) : null}

            {pdfViewerOpen ? (
              <PdfViewerOverlay
                open={pdfViewerOpen}
                url={pdfViewerUrl}
                cacheKey={pdfViewerCacheKey || undefined}
                title={pdfViewerTitle}
                subtitle={pdfViewerSubtitle || undefined}
                onClose={() => setPdfViewerOpen(false)}
              />
            ) : null}

            {parseDebugOpen ? (
              <FullScreenGlassOverlay
                title="Parsing debugger"
                subtitle={toDisplayFileName(parseDebugItem?.title) || parseDebugItem?.title || 'Resource'}
                zIndexClassName="z-50"
                onClose={() => setParseDebugOpen(false)}
              >
                <div className="rounded-2xl border border-white/15 bg-white/90 p-4 text-slate-900 space-y-3">
                  <div className="text-sm">
                    <div><span className="font-semibold">Filename:</span> {toDisplayFileName(parseDebugItem?.filename) || parseDebugItem?.filename || '—'}</div>
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

            {extractOpen ? (
              <FullScreenGlassOverlay
                title="Extract questions"
                subtitle={toDisplayFileName(extractItem?.title) || extractItem?.title || 'Resource'}
                zIndexClassName="z-50"
                onClose={() => { if (!extracting) setExtractOpen(false) }}
              >
                <div className="rounded-2xl border border-white/15 bg-white/90 p-4 text-slate-900 space-y-4">
                  <p className="text-sm text-slate-600">
                    Gemini will read the parsed OCR text and extract every question and sub-question into the question bank.
                    Set the paper metadata before extracting.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <div className="text-xs uppercase tracking-wide text-slate-600">Year</div>
                      <input
                        type="number"
                        className="input"
                        min={2000}
                        max={2100}
                        value={extractYear}
                        onChange={(e) => setExtractYear(parseInt(e.target.value, 10) || new Date().getFullYear())}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs uppercase tracking-wide text-slate-600">Exam month</div>
                      <select className="input" value={extractMonth} onChange={(e) => setExtractMonth(e.target.value)}>
                        {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs uppercase tracking-wide text-slate-600">Paper</div>
                      <select className="input" value={extractPaper} onChange={(e) => setExtractPaper(parseInt(e.target.value, 10))}>
                        <option value={1}>Paper 1</option>
                        <option value={2}>Paper 2</option>
                        <option value={3}>Paper 3</option>
                      </select>
                    </div>
                  </div>
                  {extractError ? <div className="text-sm text-red-600">{extractError}</div> : null}
                  {extractResult ? (
                    <div className="rounded-xl bg-green-50 p-3 text-sm text-green-800">
                      ✓ Extracted {extractResult.created} question{extractResult.created !== 1 ? 's' : ''}.
                      {extractResult.skipped > 0 ? ` ${extractResult.skipped} skipped (incomplete data).` : ''}{' '}
                      Use <strong>Review Questions</strong> on this resource to approve them for students.
                    </div>
                  ) : null}
                  <div className="flex items-center justify-end gap-2">
                    <button type="button" className="btn btn-ghost" onClick={() => setExtractOpen(false)} disabled={extracting}>Cancel</button>
                    <button type="button" className="btn btn-primary" onClick={() => void handleExtract()} disabled={extracting}>
                      {extracting ? 'Extracting…' : 'Extract'}
                    </button>
                  </div>
                </div>
              </FullScreenGlassOverlay>
            ) : null}

            {reviewOpen ? (
              <FullScreenGlassOverlay
                title="Review extracted questions"
                subtitle={toDisplayFileName(reviewItem?.title) || reviewItem?.title || 'Resource'}
                zIndexClassName="z-50"
                onClose={() => setReviewOpen(false)}
              >
                <div className="rounded-2xl border border-white/15 bg-white/90 p-4 text-slate-900 space-y-3">
                  {reviewLoading ? <div className="text-sm text-slate-500">Loading questions…</div> : null}
                  {reviewError ? <div className="text-sm text-red-600">{reviewError}</div> : null}
                  {!reviewLoading && !reviewError && reviewQuestions.length === 0 ? (
                    <div className="text-sm text-slate-500">
                      No questions extracted yet. Use <strong>Extract Questions</strong> first.
                    </div>
                  ) : null}
                  {!reviewLoading && reviewQuestions.length > 0 ? (
                    <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                      {reviewQuestions.map((q) => (
                        <li key={q.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-bold text-slate-400 shrink-0">Q{q.questionNumber}</span>
                              <span className={`text-xs rounded-full px-2 py-0.5 font-semibold shrink-0 ${q.approved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                {q.approved ? 'Approved' : 'Pending'}
                              </span>
                              {q.topic ? <span className="text-xs text-slate-500 truncate">{q.topic}</span> : null}
                              {q.cognitiveLevel ? <span className="text-xs text-slate-400">L{q.cognitiveLevel}</span> : null}
                              {q.marks ? <span className="text-xs text-slate-400">({q.marks} marks)</span> : null}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                className={`text-xs rounded-full px-2 py-1 font-semibold transition ${q.approved ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
                                onClick={() => void toggleApprove(q.id, q.approved)}
                                disabled={savingQId === q.id}
                              >
                                {savingQId === q.id ? '…' : q.approved ? 'Revoke' : 'Approve'}
                              </button>
                              <button
                                type="button"
                                className="text-xs rounded-full px-2 py-1 font-semibold bg-red-100 text-red-700 hover:bg-red-200 transition"
                                onClick={() => void deleteQuestion(q.id)}
                                disabled={deletingQId === q.id}
                              >
                                {deletingQId === q.id ? '…' : 'Delete'}
                              </button>
                            </div>
                          </div>
                          <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">{q.questionText}</div>
                          {q.latex ? (
                            <div className="text-xs font-mono text-slate-500 whitespace-pre-wrap break-all">{q.latex}</div>
                          ) : null}
                          <div className="text-xs text-slate-400">{q.year} {q.month} · Paper {q.paper} · {String(q.grade).replace('_', ' ')}</div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex justify-end">
                    <button type="button" className="btn btn-ghost" onClick={() => setReviewOpen(false)}>Close</button>
                  </div>
                </div>
              </FullScreenGlassOverlay>
            ) : null}

            {parsedViewerOpen ? (
              <FullScreenGlassOverlay
                title="Parsed"
                subtitle={parsedViewerTitle}
                zIndexClassName="z-50"
                rightActions={
                  <button
                    type="button"
                    className="w-9 h-9 inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 hover:bg-white/20 text-white"
                    onClick={() => void downloadParsedDocx()}
                    aria-label="Download parsed"
                    title={parsedDownloadBusy ? 'Preparing…' : 'Download as Docx'}
                    disabled={parsedDownloadBusy || parsedViewerLoading}
                  >
                    <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
                      <path d="M10 3v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M6.5 9.5L10 12.8l3.5-3.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M4 16h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                }
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
                          if (next) setConvertDocxOnUpload(false)
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
                    <label className={`flex items-center gap-2 text-sm ${convertDocxOnUpload ? 'text-white/90' : 'text-white/40'} select-none`}>
                      <input
                        type="checkbox"
                        checked={convertDocxOnUpload}
                        onChange={(e) => {
                          const next = e.target.checked
                          setConvertDocxOnUpload(next)
                          if (next) {
                            setParseOnUpload(false)
                            setAiNormalizeOnUpload(false)
                          }
                        }}
                      />
                      Convert to DOCX (Mathpix)
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
                      <li key={item.id} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-white whitespace-normal break-all">{toDisplayFileName(item.title) || item.title}</div>
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
                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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
                          {item?.parsedJson?.docxUrl ? (
                            <a
                              href={item.parsedJson.docxUrl}
                              className="btn btn-ghost"
                              target="_blank"
                              rel="noreferrer"
                              download
                            >
                              Download DOCX
                            </a>
                          ) : null}
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
                          {role === 'admin' && item.parsedAt ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => void handleDownloadLatex(item)}
                            >
                              Download LaTeX
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
                          {role === 'admin' ? (
                            <button type="button" className="btn btn-ghost" onClick={() => openEdit(item)}>
                              Edit
                            </button>
                          ) : null}
                          {role === 'admin' && item.parsedAt ? (
                            <button type="button" className="btn btn-ghost" onClick={() => openExtract(item)}>
                              Extract Questions
                            </button>
                          ) : null}
                          {role === 'admin' && item.parsedAt ? (
                            <button type="button" className="btn btn-ghost" onClick={() => void openReview(item)}>
                              Review Questions
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
