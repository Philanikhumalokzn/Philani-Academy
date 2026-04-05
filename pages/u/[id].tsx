import { useSession } from 'next-auth/react'
import type { GetServerSideProps } from 'next'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react'
import FullScreenGlassOverlay from '../../components/FullScreenGlassOverlay'
import PublicFeedPostCard from '../../components/PublicFeedPostCard'
import PostReplyComposerOverlays from '../../components/PostReplyComposerOverlays'
import { PublicSolveCanvasViewer, normalizePublicSolveScene, type PublicSolveScene } from '../../components/PublicSolveCanvas'
import UserLink from '../../components/UserLink'
import ZoomableImageOverlay from '../../components/ZoomableImageOverlay'
import { buildFeedPostActionState, type FeedPost } from '../../lib/feedContract'
import { gradeToLabel } from '../../lib/grades'
import { renderKatexDisplayHtml } from '../../lib/latexRender'
import { createLessonRoleProfile, normalizePlatformRole } from '../../lib/lessonAccessControl'
import { renderTextWithKatex } from '../../lib/renderTextWithKatex'
import {
  buildPostReplyPayloadFromBlocks,
  composePostSolveBlocksWithDraftText,
  createPostReplyBlockId,
  normalizePostReplyBlocks,
  upsertPostReplyBlock,
  type ComposerBlockCrudTarget,
  type ComposerBlockEditTarget,
  type PostReplyBlock,
  type PostSolveOverlayState,
} from '../../lib/postReplyComposer'

type PublicUser = {
  id: string
  name: string
  role?: string | null
  grade?: string | null
  avatar?: string | null
  profileCoverUrl?: string | null
  profileThemeBgUrl?: string | null
  statusBio?: string | null
  schoolName?: string | null
  verified?: boolean
  followerCount?: number
  followingCount?: number
  isFollowing?: boolean
}

type ProfilePost = FeedPost

type ProfileChallenge = {
  id: string
  title?: string | null
  prompt?: string | null
  imageUrl?: string | null
  createdAt?: string | null
}

type DiscoverProfile = {
  id: string
  name: string
  role?: string | null
  grade?: string | null
  avatar?: string | null
  schoolName?: string | null
  verified?: boolean
  sharedGroupsCount?: number
}

type ProfileTab = 'all' | 'photos' | 'reels'

const defaultMobileHeroBg = (() => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbfbfa"/>
      <stop offset="1" stop-color="#f3f5f9"/>
    </linearGradient>
    <pattern id="lines" width="120" height="36" patternUnits="userSpaceOnUse">
      <rect width="120" height="36" fill="url(#paper)"/>
      <line x1="0" y1="28" x2="120" y2="28" stroke="#d8e5f6" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="1920" height="1080" fill="url(#lines)"/>
</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
})()

const roleLabel = (value?: string | null) => {
  const raw = String(value || '').trim()
  if (!raw) return 'Learner'
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

const resolveImageUrl = (value?: string | null) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('data:')) return raw
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  if (raw.startsWith('//')) return `https:${raw}`
  if (raw.startsWith('/')) return raw
  return `/${raw}`
}

const formatShortDate = (value?: string | null) => {
  if (!value) return ''
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(dt).replace(/,/g, '')
}

const extractInitials = (name: string) => {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'U'
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase()
  return `${words[0].slice(0, 1)}${words[1].slice(0, 1)}`.toUpperCase()
}

const renderProfilePostReplyBlocks = (blocks: PostReplyBlock[], keyPrefix: string, options?: { onOpenImageBlock?: (imageUrl: string) => void }) => {
  const normalizedBlocks = normalizePostReplyBlocks(blocks)
  if (normalizedBlocks.length === 0) return null

  return (
    <div className="space-y-3 text-white/90">
      {normalizedBlocks.map((block, index) => {
        if (block.type === 'text') {
          return <div key={`${keyPrefix}-${block.id}-${index}`} className="text-sm leading-6 whitespace-pre-wrap break-words text-white/85">{block.text}</div>
        }
        if (block.type === 'latex') {
          const latexHtml = renderKatexDisplayHtml(block.latex)
          if (latexHtml) {
            return <div key={`${keyPrefix}-${block.id}-${index}`} className="leading-relaxed text-white/95" dangerouslySetInnerHTML={{ __html: latexHtml }} />
          }
          return <div key={`${keyPrefix}-${block.id}-${index}`} className="text-sm leading-6 whitespace-pre-wrap break-words text-white/85">{renderTextWithKatex(block.latex)}</div>
        }
        if (block.type === 'image') {
          return (
            <div key={`${keyPrefix}-${block.id}-${index}`}>
              <button type="button" className="block w-full text-left" onClick={() => options?.onOpenImageBlock?.(block.imageUrl)}>
                <img src={block.imageUrl} alt="Reply attachment" className="max-h-[320px] w-full rounded-2xl border border-white/10 bg-white/5 object-contain" />
              </button>
            </div>
          )
        }
        return (
          <div key={`${keyPrefix}-${block.id}-${index}`}>
            <div className="overflow-hidden rounded-2xl border border-[#1d4f91] bg-white shadow-sm">
              <PublicSolveCanvasViewer scene={block.scene} className="pointer-events-none" viewerHeightPx={220} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function PublicUserProfilePage() {
  const router = useRouter()
  const { status, data: session } = useSession()

  const userId = typeof router.query?.id === 'string' ? router.query.id : ''

  const [profile, setProfile] = useState<PublicUser | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [posts, setPosts] = useState<ProfilePost[]>([])
  const [postsLoading, setPostsLoading] = useState(false)
  const [postsError, setPostsError] = useState<string | null>(null)

  const [challenges, setChallenges] = useState<ProfileChallenge[]>([])
  const [challengesLoading, setChallengesLoading] = useState(false)

  const [discoverProfiles, setDiscoverProfiles] = useState<DiscoverProfile[]>([])
  const [discoverLoading, setDiscoverLoading] = useState(false)

  const [viewerId, setViewerId] = useState('')
  const [followBusy, setFollowBusy] = useState(false)
  const [activeTab, setActiveTab] = useState<ProfileTab>('all')
  const [imageViewer, setImageViewer] = useState<{ url: string; title: string } | null>(null)
  const [likedPostKeys, setLikedPostKeys] = useState<Record<string, boolean>>({})
  const [lastSharedPostKey, setLastSharedPostKey] = useState<string | null>(null)
  const [expandedProfilePostId, setExpandedProfilePostId] = useState<string | null>(null)
  const socialShareResetTimeoutRef = useRef<number | null>(null)
  const [postSolveModeOverlay, setPostSolveModeOverlay] = useState<PostSolveOverlayState | null>(null)
  const [postSolveOverlay, setPostSolveOverlay] = useState<PostSolveOverlayState | null>(null)
  const [postTypedSolveOverlay, setPostTypedSolveOverlay] = useState<PostSolveOverlayState | null>(null)
  const [postThreadOverlay, setPostThreadOverlay] = useState<null | {
    postId: string
    threadKey: string
    title: string
    prompt: string
    imageUrl?: string | null
    authorName?: string | null
    authorAvatarUrl?: string | null
  }>(null)
  const [postThreadLoading, setPostThreadLoading] = useState(false)
  const [postThreadError, setPostThreadError] = useState<string | null>(null)
  const [postThreadResponses, setPostThreadResponses] = useState<any[]>([])
  const [postSolveBlocks, setPostSolveBlocks] = useState<PostReplyBlock[]>([])
  const [postSolveText, setPostSolveText] = useState('')
  const [postTypedSolveLatex, setPostTypedSolveLatex] = useState('')
  const [postSolveSubmitting, setPostSolveSubmitting] = useState(false)
  const [postReplyImageUploading, setPostReplyImageUploading] = useState(false)
  const [postReplyImageSourceSheetOpen, setPostReplyImageSourceSheetOpen] = useState(false)
  const [postReplyImageEditOpen, setPostReplyImageEditOpen] = useState(false)
  const [postReplyImageEditFile, setPostReplyImageEditFile] = useState<File | null>(null)
  const [postSolveError, setPostSolveError] = useState<string | null>(null)
  const [postSolveEditingTarget, setPostSolveEditingTarget] = useState<ComposerBlockEditTarget | null>(null)
  const [composerBlockCrudTarget, setComposerBlockCrudTarget] = useState<ComposerBlockCrudTarget | null>(null)
  const [postTypedOverlayChromeVisible, setPostTypedOverlayChromeVisible] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const composerBlockLongPressTimeoutRef = useRef<number | null>(null)
  const composerBlockLongPressStateRef = useRef<null | { x: number; y: number; target: ComposerBlockCrudTarget }>(null)
  const composerBlockLongPressOpenedRef = useRef(false)
  const postReplyCameraInputRef = useRef<HTMLInputElement | null>(null)
  const postReplyGalleryInputRef = useRef<HTMLInputElement | null>(null)
  const postSolveTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  const sessionPlatformRole = normalizePlatformRole((session as any)?.user?.role)
  const currentLessonRoleProfile = useMemo(() => createLessonRoleProfile({ platformRole: sessionPlatformRole }), [sessionPlatformRole])
  const currentViewerId = String(viewerId || (session as any)?.user?.id || '')
  const currentViewerName = String(session?.user?.name || session?.user?.email || 'You')
  const activeGradeLabel = useMemo(() => {
    const rawGrade = typeof (session as any)?.user?.grade === 'string' ? (session as any).user.grade : ''
    return rawGrade ? gradeToLabel(rawGrade as any) : null
  }, [session])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const syncIsMobile = () => setIsMobile(window.innerWidth < 640)
    syncIsMobile()
    window.addEventListener('resize', syncIsMobile)
    return () => window.removeEventListener('resize', syncIsMobile)
  }, [])

  const closePostReplyImageEdit = useCallback(() => {
    setPostReplyImageEditOpen(false)
    setPostReplyImageEditFile(null)
  }, [])

  const uploadPostReplyImage = useCallback(async (file: File) => {
    setPostReplyImageUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/challenges/upload', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Upload failed (${res.status})`)
      const imageUrl = typeof data?.url === 'string' ? data.url.trim() : ''
      if (!imageUrl) throw new Error('Upload succeeded but returned no URL')
      setPostSolveBlocks((prev) => [...prev, { id: createPostReplyBlockId(), type: 'image', imageUrl }])
      setPostSolveError(null)
    } finally {
      setPostReplyImageUploading(false)
    }
  }, [])

  const openPostReplyImagePicker = useCallback(() => {
    setPostReplyImageSourceSheetOpen(true)
  }, [])

  const openPostReplyCameraPicker = useCallback(() => {
    try {
      setPostReplyImageSourceSheetOpen(false)
      postReplyCameraInputRef.current?.click()
    } catch {
      // ignore
    }
  }, [])

  const openPostReplyGalleryPicker = useCallback(() => {
    try {
      setPostReplyImageSourceSheetOpen(false)
      postReplyGalleryInputRef.current?.click()
    } catch {
      // ignore
    }
  }, [])

  const onPostReplyImagePicked = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPostReplyImageEditFile(file)
    setPostReplyImageEditOpen(true)
  }, [])

  const confirmPostReplyImageEdit = useCallback(async (file: File) => {
    try {
      closePostReplyImageEdit()
      await uploadPostReplyImage(file)
    } catch (err: any) {
      setPostSolveError(err?.message || 'Failed to upload image')
    }
  }, [closePostReplyImageEdit, uploadPostReplyImage])

  const fetchPublicThreadResponses = useCallback(async (threadKey: string) => {
    const safeThreadKey = String(threadKey || '').trim()
    if (!safeThreadKey) return []
    const res = await fetch(`/api/threads/${encodeURIComponent(safeThreadKey)}/responses`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.message || `Failed to load solutions (${res.status})`)
    const responses = Array.isArray(data?.responses) ? data.responses : []
    return responses.slice().sort((a: any, b: any) => {
      const aTs = Math.max(a?.updatedAt ? new Date(a.updatedAt).getTime() : 0, a?.createdAt ? new Date(a.createdAt).getTime() : 0)
      const bTs = Math.max(b?.updatedAt ? new Date(b.updatedAt).getTime() : 0, b?.createdAt ? new Date(b.createdAt).getTime() : 0)
      return bTs - aTs
    })
  }, [])

  const openLocalPostThread = useCallback(async (post: ProfilePost, options?: { forceOpen?: boolean }) => {
    const postId = String(post?.id || '')
    const threadKey = typeof post?.threadKey === 'string' ? post.threadKey : `post:${postId}`
    if (!postId || !threadKey) return

    if (!options?.forceOpen && expandedProfilePostId === postId) {
      setExpandedProfilePostId(null)
      setPostThreadError(null)
      setPostThreadResponses([])
      return
    }

    setExpandedProfilePostId(postId)
    setPostThreadLoading(true)
    setPostThreadError(null)
    try {
      const responses = await fetchPublicThreadResponses(threadKey)
      setPostThreadResponses(responses)
    } catch (err: any) {
      setPostThreadResponses([])
      setPostThreadError(err?.message || 'Failed to load solutions')
    } finally {
      setPostThreadLoading(false)
    }
  }, [expandedProfilePostId, fetchPublicThreadResponses])

  const focusPostSolveTextarea = useCallback(() => {
    if (typeof window === 'undefined') return
    window.setTimeout(() => {
      postSolveTextareaRef.current?.focus()
      const length = postSolveTextareaRef.current?.value.length || 0
      postSolveTextareaRef.current?.setSelectionRange(length, length)
    }, 0)
  }, [])

  const resizePostSolveTextarea = useCallback(() => {
    const textarea = postSolveTextareaRef.current
    if (!textarea) return
    const maxHeightPx = 112
    textarea.style.height = 'auto'
    const nextHeight = Math.min(textarea.scrollHeight, maxHeightPx)
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeightPx ? 'auto' : 'hidden'
  }, [])

  useEffect(() => {
    if (!postSolveModeOverlay) return
    resizePostSolveTextarea()
  }, [postSolveModeOverlay, postSolveText, resizePostSolveTextarea])

  const openHandwrittenPostSolveComposer = useCallback((draft: PostSolveOverlayState | null, options?: { editTarget?: ComposerBlockEditTarget | null }) => {
    if (!draft) return
    const currentText = String(postSolveText || '')
    const committedBlocks = composePostSolveBlocksWithDraftText(postSolveBlocks, currentText, postSolveEditingTarget)
    const editTarget = options?.editTarget && options.editTarget.type === 'canvas' ? options.editTarget : null
    const editingCanvasBlock = editTarget
      ? committedBlocks.find((block): block is any => block.id === editTarget.blockId && block.type === 'canvas')
      : null
    const existingCanvasBlock = [...committedBlocks].reverse().find((block) => block.type === 'canvas') as any
    setPostSolveBlocks(committedBlocks)
    setPostSolveText('')
    setPostSolveEditingTarget(editTarget)
    setComposerBlockCrudTarget(null)
    setPostSolveModeOverlay(null)
    setPostTypedSolveOverlay(null)
    setPostSolveError(null)
    setPostSolveOverlay({
      ...draft,
      initialScene: editingCanvasBlock?.scene || existingCanvasBlock?.scene || draft.initialScene || null,
      initialStudentText: '',
    })
  }, [postSolveBlocks, postSolveEditingTarget, postSolveText])

  const openTypedPostSolveComposer = useCallback((draft: PostSolveOverlayState | null, preferredRecognitionEngine: 'keyboard' | 'myscript' | 'mathpix' = 'keyboard', options?: { editTarget?: ComposerBlockEditTarget | null; initialLatex?: string | null }) => {
    if (!draft) return
    const currentText = String(postSolveText || '')
    const committedBlocks = composePostSolveBlocksWithDraftText(postSolveBlocks, currentText, postSolveEditingTarget)
    const editTarget = options?.editTarget && options.editTarget.type === 'latex' ? options.editTarget : null
    setPostSolveBlocks(committedBlocks)
    setPostSolveText('')
    setPostSolveEditingTarget(editTarget)
    setComposerBlockCrudTarget(null)
    setPostSolveModeOverlay(null)
    setPostSolveOverlay(null)
    setPostSolveError(null)
    setPostTypedOverlayChromeVisible(!isMobile)
    setPostTypedSolveLatex(String(options?.initialLatex || ''))
    setPostTypedSolveOverlay({
      ...draft,
      initialLatex: String(options?.initialLatex || ''),
      initialStudentText: '',
      preferredRecognitionEngine,
    })
  }, [isMobile, postSolveBlocks, postSolveEditingTarget, postSolveText])

  const openLocalPostSolveComposer = useCallback(async (post: ProfilePost, options?: { initialScene?: any | null; initialLatex?: string | null; initialStudentText?: string | null; initialGradingJson?: any | null }) => {
    const postId = String(post?.id || '')
    const threadKey = typeof post?.threadKey === 'string' ? post.threadKey : `post:${postId}`
    if (!postId || !threadKey) return

    const authorName = String(post?.createdBy?.name || profile?.name || 'Poster').trim() || 'Poster'
    const authorAvatarUrl = resolveImageUrl(post?.createdBy?.avatar || profile?.avatar || '')

    setPostSolveError(null)
    let initialResponseSource: any = {
      excalidrawScene: options?.initialScene ?? null,
      latex: typeof options?.initialLatex === 'string' ? options.initialLatex : '',
      studentText: typeof options?.initialStudentText === 'string' ? options.initialStudentText : '',
      gradingJson: options?.initialGradingJson ?? null,
    }
    if (!options?.initialGradingJson && !options?.initialScene && !options?.initialLatex && !options?.initialStudentText) {
      try {
        const responses = await fetchPublicThreadResponses(threadKey)
        const mine = responses.find((response: any) => String(response?.userId || '') === currentViewerId)
        if (mine) initialResponseSource = mine
      } catch {
        // ignore prefill failures and still open the composer
      }
    }

    const initialBlocks = normalizePostReplyBlocks(initialResponseSource)
    const initialPayload = buildPostReplyPayloadFromBlocks(initialBlocks)

    setPostSolveBlocks(initialBlocks)
    setPostSolveText('')
    setPostSolveEditingTarget(null)
    setComposerBlockCrudTarget(null)
    setPostTypedSolveOverlay(null)
    setPostSolveOverlay(null)
    setPostSolveModeOverlay({
      postId,
      threadKey,
      title: String(post?.title || 'Post'),
      prompt: String(post?.prompt || 'Share your solution for this post.'),
      imageUrl: resolveImageUrl(post?.imageUrl) || null,
      authorName,
      authorAvatarUrl,
      initialScene: initialPayload.excalidrawScene,
      initialLatex: initialPayload.latex,
      initialStudentText: initialPayload.studentText,
      initialGradingJson: initialPayload.gradingJson,
      postRecord: post,
    })
  }, [currentViewerId, fetchPublicThreadResponses, profile?.avatar, profile?.name])

  const applyOwnPostResponse = useCallback((draft: Pick<PostSolveOverlayState, 'postId'>, responseData: any) => {
    setPosts((prev) => Array.isArray(prev) ? prev.map((item) => {
      if (String(item?.id || '') !== String(draft.postId || '')) return item
      const previousOwnResponseId = String((item as any)?.ownResponse?.id || '')
      const nextOwnResponseId = String(responseData?.id || '')
      const isNewResponseRecord = !previousOwnResponseId || (nextOwnResponseId && nextOwnResponseId !== previousOwnResponseId)
      const previousAttemptCount = typeof (item as any)?.myAttemptCount === 'number' ? (item as any).myAttemptCount : 0
      const previousSolutionCount = Number((item as any)?.solutionCount || 0)
      return {
        ...(item as any),
        hasOwnResponse: true,
        ownResponse: responseData || (item as any)?.ownResponse || null,
        myAttemptCount: isNewResponseRecord ? previousAttemptCount + 1 : Math.max(previousAttemptCount, 1),
        solutionCount: isNewResponseRecord ? Math.max(1, previousSolutionCount + 1) : Math.max(1, previousSolutionCount),
      }
    }) : prev)
  }, [])

  const submitPostTextSolve = useCallback(async () => {
    const activeDraft = postSolveModeOverlay
    if (!activeDraft?.postId || !activeDraft?.threadKey) return
    const payload = buildPostReplyPayloadFromBlocks(composePostSolveBlocksWithDraftText(postSolveBlocks, String(postSolveText || ''), postSolveEditingTarget))
    if (!payload.contentBlocks.length) {
      setPostSolveError('Write a reply before sending.')
      return
    }

    setPostSolveSubmitting(true)
    setPostSolveError(null)
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(activeDraft.threadKey)}/responses`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latex: payload.latex,
          studentText: payload.studentText,
          contentBlocks: payload.contentBlocks,
          quizId: activeDraft.threadKey,
          quizLabel: activeDraft.title,
          prompt: activeDraft.prompt,
          excalidrawScene: payload.excalidrawScene,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || `Failed to submit reply (${res.status})`)

      applyOwnPostResponse(activeDraft, data)
      setPostSolveModeOverlay(null)
      setPostSolveOverlay(null)
      setPostTypedSolveOverlay(null)
      setPostSolveBlocks([])
      setPostSolveText('')
      setPostTypedSolveLatex('')
      setPostSolveEditingTarget(null)
      setComposerBlockCrudTarget(null)
      setPostReplyImageSourceSheetOpen(false)
      await openLocalPostThread(activeDraft as any, { forceOpen: true })
    } catch (err: any) {
      setPostSolveError(err?.message || 'Failed to submit reply')
    } finally {
      setPostSolveSubmitting(false)
    }
  }, [applyOwnPostResponse, openLocalPostThread, postSolveBlocks, postSolveEditingTarget, postSolveModeOverlay, postSolveText])

  const submitPostSolve = useCallback(async (scene: PublicSolveScene) => {
    const activeDraft = postSolveOverlay
    const normalizedScene = normalizePublicSolveScene(scene)
    if (!activeDraft?.postId || !activeDraft?.threadKey || !normalizedScene) return

    setPostSolveBlocks((prev) => {
      if (postSolveEditingTarget?.type === 'canvas') {
        return upsertPostReplyBlock(prev, { id: postSolveEditingTarget.blockId, type: 'canvas', scene: normalizedScene }, postSolveEditingTarget, 'canvas')
      }
      const nextBlocks: PostReplyBlock[] = prev.filter((block) => block.type !== 'canvas')
      nextBlocks.push({ id: createPostReplyBlockId(), type: 'canvas', scene: normalizedScene })
      return nextBlocks
    })

    setPostSolveOverlay(null)
    setPostSolveEditingTarget(null)
    setPostSolveModeOverlay({
      ...activeDraft,
      initialScene: normalizedScene,
      initialStudentText: '',
    })
    setPostSolveError(null)
  }, [postSolveEditingTarget, postSolveOverlay])

  const submitTypedPostSolve = useCallback(async () => {
    const activeDraft = postTypedSolveOverlay
    const latex = String(postTypedSolveLatex || '').trim()
    if (!activeDraft?.postId || !activeDraft?.threadKey) return
    if (!latex) {
      setPostSolveError('Write a typed response before adding it.')
      return
    }
    setPostSolveBlocks((prev) => upsertPostReplyBlock(prev, { id: createPostReplyBlockId(), type: 'latex', latex }, postSolveEditingTarget, 'latex'))
    setPostSolveModeOverlay({
      ...activeDraft,
      initialLatex: '',
      initialStudentText: '',
    })
    setPostTypedSolveOverlay(null)
    setPostTypedOverlayChromeVisible(false)
    setPostTypedSolveLatex('')
    setPostSolveEditingTarget(null)
    setPostSolveError(null)
  }, [postSolveEditingTarget, postTypedSolveLatex, postTypedSolveOverlay])

  const deleteComposerBlock = useCallback((blockId: string) => {
    setPostSolveBlocks((prev) => prev.filter((block) => block.id !== blockId))
    setPostSolveEditingTarget((current) => current?.blockId === blockId ? null : current)
    setComposerBlockCrudTarget((current) => current?.block.id === blockId ? null : current)
  }, [])

  const clearComposerBlockLongPress = useCallback(() => {
    if (composerBlockLongPressTimeoutRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(composerBlockLongPressTimeoutRef.current)
    }
    composerBlockLongPressTimeoutRef.current = null
    composerBlockLongPressStateRef.current = null
  }, [])

  const openComposerBlockCrudOptions = useCallback((target: ComposerBlockCrudTarget) => {
    clearComposerBlockLongPress()
    setComposerBlockCrudTarget(target)
  }, [clearComposerBlockLongPress])

  const beginComposerBlockLongPress = useCallback((event: ReactPointerEvent, target: ComposerBlockCrudTarget) => {
    if (typeof window === 'undefined') return
    if (event.button !== 0) return
    clearComposerBlockLongPress()
    composerBlockLongPressStateRef.current = { x: event.clientX, y: event.clientY, target }
    composerBlockLongPressOpenedRef.current = false
    composerBlockLongPressTimeoutRef.current = window.setTimeout(() => {
      composerBlockLongPressOpenedRef.current = true
      openComposerBlockCrudOptions(target)
    }, 420)
  }, [clearComposerBlockLongPress, openComposerBlockCrudOptions])

  const moveComposerBlockLongPress = useCallback((event: ReactPointerEvent) => {
    const state = composerBlockLongPressStateRef.current
    if (!state) return
    const dx = event.clientX - state.x
    const dy = event.clientY - state.y
    if (Math.hypot(dx, dy) > 10) clearComposerBlockLongPress()
  }, [clearComposerBlockLongPress])

  const editComposerBlock = useCallback((block: PostReplyBlock, index: number) => {
    if (composerBlockLongPressOpenedRef.current) {
      composerBlockLongPressOpenedRef.current = false
      return
    }
    setComposerBlockCrudTarget(null)
    if (!postSolveModeOverlay) return
    const target: ComposerBlockEditTarget = { blockId: block.id, type: block.type, index }
    if (block.type === 'text') {
      setPostSolveEditingTarget(target)
      setPostSolveText(block.text)
      focusPostSolveTextarea()
      return
    }
    if (block.type === 'latex') {
      openTypedPostSolveComposer(postSolveModeOverlay, 'keyboard', { editTarget: target, initialLatex: block.latex })
      return
    }
    if (block.type === 'canvas') {
      openHandwrittenPostSolveComposer(postSolveModeOverlay, { editTarget: target })
      return
    }
    setImageViewer({ url: block.imageUrl, title: 'Reply attachment' })
  }, [focusPostSolveTextarea, openHandwrittenPostSolveComposer, openTypedPostSolveComposer, postSolveModeOverlay])

  const loadProfile = useCallback(async () => {
    if (!userId) return
    setProfileLoading(true)
    setProfileError(null)
    try {
      const res = await fetch(`/api/profile/view/${encodeURIComponent(userId)}`, { credentials: 'same-origin', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || 'Failed to load profile')
      setProfile({
        id: String(data?.id || userId),
        name: String(data?.name || 'User'),
        role: typeof data?.role === 'string' ? data.role : null,
        grade: typeof data?.grade === 'string' ? data.grade : null,
        avatar: typeof data?.avatar === 'string' ? data.avatar : null,
        profileCoverUrl: typeof data?.profileCoverUrl === 'string' ? data.profileCoverUrl : null,
        profileThemeBgUrl: typeof data?.profileThemeBgUrl === 'string' ? data.profileThemeBgUrl : null,
        statusBio: typeof data?.statusBio === 'string' ? data.statusBio : null,
        schoolName: typeof data?.schoolName === 'string' ? data.schoolName : null,
        verified: Boolean(data?.verified),
        followerCount: typeof data?.followerCount === 'number' ? data.followerCount : 0,
        followingCount: typeof data?.followingCount === 'number' ? data.followingCount : 0,
        isFollowing: Boolean(data?.isFollowing),
      })
    } catch (err: any) {
      setProfile(null)
      setProfileError(err?.message || 'Failed to load profile')
    } finally {
      setProfileLoading(false)
    }
  }, [userId])

  const loadPosts = useCallback(async () => {
    if (!userId) return
    setPostsLoading(true)
    setPostsError(null)
    try {
      const res = await fetch(`/api/profile/view/${encodeURIComponent(userId)}/posts`, { credentials: 'same-origin', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || 'Failed to load posts')
      setPosts(Array.isArray(data?.posts) ? data.posts : [])
    } catch (err: any) {
      setPosts([])
      setPostsError(err?.message || 'Failed to load posts')
    } finally {
      setPostsLoading(false)
    }
  }, [userId])

  const loadChallenges = useCallback(async () => {
    if (!userId) return
    setChallengesLoading(true)
    try {
      const res = await fetch(`/api/profile/view/${encodeURIComponent(userId)}/challenges`, { credentials: 'same-origin', cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setChallenges([])
        return
      }
      setChallenges(Array.isArray(data?.challenges) ? data.challenges : [])
    } catch {
      setChallenges([])
    } finally {
      setChallengesLoading(false)
    }
  }, [userId])

  const loadDiscoverProfiles = useCallback(async () => {
    if (status !== 'authenticated') {
      setDiscoverProfiles([])
      return
    }
    setDiscoverLoading(true)
    try {
      const res = await fetch('/api/discover/users?limit=8', { credentials: 'same-origin', cache: 'no-store' })
      const data = await res.json().catch(() => ([]))
      if (!res.ok) {
        setDiscoverProfiles([])
        return
      }
      const nextProfiles = (Array.isArray(data) ? data : [])
        .filter((item: any) => String(item?.id || '') !== String(userId || ''))
        .slice(0, 8)
      setDiscoverProfiles(nextProfiles)
    } catch {
      setDiscoverProfiles([])
    } finally {
      setDiscoverLoading(false)
    }
  }, [status, userId])

  useEffect(() => {
    void loadProfile()
    void loadPosts()
    void loadChallenges()
  }, [loadChallenges, loadPosts, loadProfile])

  useEffect(() => {
    if (status !== 'authenticated') {
      setViewerId('')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || cancelled) return
        setViewerId(typeof data?.id === 'string' ? data.id : '')
      } catch {
        if (!cancelled) setViewerId('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [status])

  useEffect(() => {
    void loadDiscoverProfiles()
  }, [loadDiscoverProfiles])

  const displayName = profile?.name || 'Profile'
  const firstName = useMemo(() => String(displayName || '').trim().split(/\s+/).filter(Boolean)[0] || 'User', [displayName])
  const profileHandle = `@${displayName.replace(/[^a-zA-Z0-9]+/g, '').trim() || 'profile'}`
  const coverUrl = resolveImageUrl(profile?.profileCoverUrl) || resolveImageUrl(profile?.profileThemeBgUrl) || defaultMobileHeroBg
  const avatarUrl = resolveImageUrl(profile?.avatar)
  const isSelf = Boolean(profile && viewerId && String(profile.id) === String(viewerId))
  const canFollow = Boolean(profile && viewerId && !isSelf)
  const gradeLabel = profile?.grade ? gradeToLabel(profile.grade as any) : null

  const photoPosts = useMemo(
    () => posts.filter((post) => Boolean(resolveImageUrl(post.imageUrl))),
    [posts],
  )

  const reelItems = useMemo(
    () => challenges.filter((challenge) => Boolean(resolveImageUrl(challenge.imageUrl))),
    [challenges],
  )

  const handleBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
      return
    }
    void router.push('/dashboard?panel=discover')
  }, [router])

  const toggleFollow = useCallback(async () => {
    if (!profile || !viewerId || isSelf) return
    setFollowBusy(true)
    try {
      const method = profile.isFollowing ? 'DELETE' : 'POST'
      const res = await fetch(`/api/follow/${encodeURIComponent(profile.id)}`, {
        method,
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || 'Failed to update follow state')
      setProfile((current) => (current ? {
        ...current,
        isFollowing: Boolean(data?.isFollowing),
        followerCount: typeof data?.followerCount === 'number' ? data.followerCount : current.followerCount,
      } : current))
    } catch (err: any) {
      alert(err?.message || 'Failed to update follow state')
    } finally {
      setFollowBusy(false)
    }
  }, [isSelf, profile, viewerId])

  const openImageViewer = useCallback((url: string, title: string) => {
    if (!url) return
    setImageViewer({ url, title })
  }, [])

  const closeImageViewer = useCallback(() => {
    setImageViewer(null)
  }, [])

  const openDashboardPostThread = useCallback(async (postId: string) => {
    const safePostId = String(postId || '').trim()
    if (!safePostId) return
    await router.push({
      pathname: '/dashboard',
      query: {
        openFeedThreadId: safePostId,
        openFeedThreadKind: 'post',
      },
    })
  }, [router])

  const toggleProfileLike = useCallback((itemKey: string) => {
    if (!itemKey) return
    setLikedPostKeys((current) => ({ ...current, [itemKey]: !current[itemKey] }))
  }, [])

  const markProfileShareHandled = useCallback((itemKey: string) => {
    if (!itemKey) return
    setLastSharedPostKey(itemKey)
    if (typeof window === 'undefined') return
    if (socialShareResetTimeoutRef.current !== null) {
      window.clearTimeout(socialShareResetTimeoutRef.current)
    }
    socialShareResetTimeoutRef.current = window.setTimeout(() => {
      setLastSharedPostKey((current) => (current === itemKey ? null : current))
      socialShareResetTimeoutRef.current = null
    }, 1800)
  }, [])

  const shareProfilePost = useCallback(async (opts: { itemKey: string; title: string; path: string; text?: string }) => {
    const { itemKey, title, path, text } = opts
    if (!itemKey || !path) return

    const absoluteUrl = typeof window === 'undefined'
      ? path
      : new URL(path, window.location.origin).toString()

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title, text, url: absoluteUrl })
        markProfileShareHandled(itemKey)
        return
      }

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(absoluteUrl)
        markProfileShareHandled(itemKey)
        alert('Link copied')
        return
      }

      if (typeof window !== 'undefined') {
        window.prompt('Copy this link', absoluteUrl)
        markProfileShareHandled(itemKey)
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      alert(err?.message || 'Failed to share')
    }
  }, [markProfileShareHandled])

  useEffect(() => () => {
    if (typeof window !== 'undefined' && socialShareResetTimeoutRef.current !== null) {
      window.clearTimeout(socialShareResetTimeoutRef.current)
    }
  }, [])

  const renderPostCard = (post: ProfilePost) => {
    const postId = String(post.id || '')
    const itemKey = `post:${postId}`
    const authorName = String(post?.createdBy?.name || displayName || 'Learner').trim() || 'Learner'
    const authorId = String(post?.createdBy?.id || profile?.id || '').trim() || null
    const authorAvatar = resolveImageUrl(post?.createdBy?.avatar || avatarUrl)
    const authorRole = String(post?.createdBy?.role || profile?.role || '').toLowerCase()
    const authorVerified = authorRole === 'admin' || authorRole === 'teacher' || Boolean(profile?.verified)
    const actionState = buildFeedPostActionState(post)
    const isExpanded = expandedProfilePostId === postId
    const inlineThreadContent = isExpanded ? (
      <div className="mt-1 pt-1">
        {postThreadLoading ? <div className="text-sm text-[#65676b]">Loading solutions...</div> : null}
        {!postThreadLoading && postThreadError ? <div className="text-sm text-red-500">{postThreadError}</div> : null}
        {!postThreadLoading && !postThreadError && postThreadResponses.length === 0 ? (
          <div className="rounded-2xl bg-[#f0f2f5] px-4 py-3 text-sm text-[#65676b]">No solutions yet.</div>
        ) : null}
        {!postThreadLoading && !postThreadError && postThreadResponses.length > 0 ? (
          <div className="space-y-3">
            {postThreadResponses.map((response: any, idx: number) => {
              const responseUserId = String(response?.userId || response?.user?.id || '')
              const responseUserName = String(response?.user?.name || response?.userName || response?.user?.email || 'Learner')
              const responseAvatar = String(response?.user?.avatar || response?.userAvatar || '').trim()
              const postReplyBlocks = normalizePostReplyBlocks(response)

              return (
                <div key={String(response?.id || idx)} className="py-1">
                  <div className="flex items-start gap-3">
                    <UserLink userId={responseUserId || null} className="shrink-0" title="View profile">
                      <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-[#f0f2f5]">
                        {responseAvatar ? (
                          <img src={responseAvatar} alt={responseUserName} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[11px] font-semibold text-[#1c1e21]">{responseUserName.slice(0, 1).toUpperCase()}</span>
                        )}
                      </div>
                    </UserLink>
                    <div className="min-w-0 flex-1">
                      <UserLink userId={responseUserId || null} className="text-[13px] font-semibold text-[#1c1e21] hover:underline" title="View profile">
                        {responseUserName}
                      </UserLink>
                      <div className="mt-2 min-w-0 rounded-[20px] pr-2">
                        {postReplyBlocks.length > 0 ? (
                          renderProfilePostReplyBlocks(postReplyBlocks, `inline-profile-post-reply-${String(response?.id || idx)}`, {
                            onOpenImageBlock: (imageUrl) => openImageViewer(imageUrl, `${responseUserName} attachment`),
                          })
                        ) : (
                          <div className="rounded-xl border border-black/5 bg-[#f0f2f5] px-3 py-2 text-sm text-[#65676b]">No solution content.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    ) : null

    const handleSolveAction = () => {
      if (actionState.solveAction === 'closed') return
      if (actionState.solveAction === 'solutions') {
        void openLocalPostThread(post, { forceOpen: true })
        return
      }
      void openLocalPostSolveComposer(post)
    }

    return (
      <article key={post.id} className="border-b border-black/10 bg-white px-4 py-3 sm:px-6">
        <PublicFeedPostCard
          authorId={authorId}
          authorName={authorName}
          authorAvatar={authorAvatar}
          authorVerified={authorVerified}
          createdAt={formatShortDate(post.createdAt)}
          title={String(post.title || '').trim() || 'Post'}
          prompt={post.prompt || ''}
          imageUrl={resolveImageUrl(post.imageUrl)}
          expanded={isExpanded}
          onOpen={() => void openLocalPostThread(post, { forceOpen: true })}
          onOpenImage={openImageViewer}
          actions={[
            {
              label: 'Like',
              active: Boolean(likedPostKeys[itemKey]),
              onClick: () => toggleProfileLike(itemKey),
              icon: (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                  <path d="M14 9V5.5C14 4.11929 12.8807 3 11.5 3C10.714 3 9.97327 3.36856 9.5 4L6 9V21H17.18C18.1402 21 18.9724 20.3161 19.1604 19.3744L20.7604 11.3744C21.0098 10.1275 20.0557 9 18.7841 9H14Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M6 21H4C3.44772 21 3 20.5523 3 20V10C3 9.44772 3.44772 9 4 9H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ),
            },
            {
              label: actionState.solveLabel,
              onClick: handleSolveAction,
              disabled: actionState.solveAction === 'closed',
              icon: (
                <span className="flex items-center gap-1" aria-hidden="true">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                    <path d="M7 18L3.8 20.4C3.47086 20.6469 3 20.412 3 20V6C3 4.89543 3.89543 4 5 4H19C20.1046 4 21 4.89543 21 6V16C21 17.1046 20.1046 18 19 18H7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none">
                    <path d="M4 20H8L18.5 9.5C19.3284 8.67157 19.3284 7.32843 18.5 6.5C17.6716 5.67157 16.3284 5.67157 15.5 6.5L5 17V20Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14.5 7.5L17.5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              ),
            },
            {
              label: 'Share',
              statusLabel: lastSharedPostKey === itemKey ? 'Copied' : undefined,
              onClick: () => void shareProfilePost({
                itemKey,
                title: String(post.title || '').trim() || 'Post',
                text: String(post.prompt || '').trim() || String(post.title || '').trim() || 'Post',
                path: `/u/${encodeURIComponent(String(userId || profile?.id || ''))}?postId=${encodeURIComponent(postId)}`,
              }),
              icon: (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                  <path d="M14 5L20 11L14 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 19V17C4 13.6863 6.68629 11 10 11H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ),
            },
          ]}
        >
          {inlineThreadContent}
        </PublicFeedPostCard>
      </article>
    )
  }

  const renderPhotoGrid = () => {
    if (postsLoading) return <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">Loading photos...</div>
    if (photoPosts.length === 0) return <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">No photos yet.</div>
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photoPosts.map((post) => {
          const postImageUrl = resolveImageUrl(post.imageUrl)
          return (
            <button
              key={post.id}
              type="button"
              className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.08)]"
              onClick={() => openImageViewer(postImageUrl, post.title || `${displayName} photo`)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={postImageUrl} alt={post.title || 'Photo'} className="aspect-square w-full object-cover" />
            </button>
          )
        })}
      </div>
    )
  }

  const renderReels = () => {
    if (challengesLoading) return <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">Loading reels...</div>
    if (reelItems.length === 0) return <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">No reels yet.</div>
    return (
      <div className="space-y-4">
        {reelItems.map((item) => {
          const imageUrl = resolveImageUrl(item.imageUrl)
          return (
            <article key={item.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_16px_36px_rgba(15,23,42,0.08)]">
              <button type="button" className="block w-full text-left" onClick={() => openImageViewer(imageUrl, item.title || 'Reel')}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt={item.title || 'Reel'} className="max-h-[36rem] w-full object-cover" />
              </button>
              <div className="px-5 py-4">
                <div className="text-[17px] font-semibold tracking-[-0.03em] text-slate-900">{item.title || 'Reel'}</div>
                {item.prompt ? <p className="mt-2 text-[15px] leading-7 text-slate-700">{item.prompt}</p> : null}
              </div>
            </article>
          )
        })}
      </div>
    )
  }

  return (
    <main className="public-profile-page min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#f5f8fd_30%,#f7f8fb_100%)] text-slate-900">
      <div className="min-h-screen pb-[calc(var(--app-safe-bottom)+2rem)]">
        <section className="public-profile-hero relative w-full overflow-hidden bg-slate-900">
          <div className="public-profile-hero__image absolute inset-0" style={{ backgroundImage: `url("${coverUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} aria-hidden="true" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.42)_0%,rgba(0,0,0,0.18)_30%,rgba(0,0,0,0.32)_100%)]" aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.7)_72%,#ffffff_100%)]" aria-hidden="true" />
          <div className="public-profile-hero__chrome relative min-h-[17rem] px-4 pb-32 pt-[calc(var(--app-safe-top)+0.85rem)] sm:min-h-[20rem] sm:px-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white shadow-[0_10px_24px_rgba(0,0,0,0.24)] backdrop-blur-sm transition hover:bg-black/50"
                  aria-label="Go back"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                    <path d="M15 18 9 12l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white shadow-[0_10px_24px_rgba(0,0,0,0.24)] backdrop-blur-sm transition hover:bg-black/50"
                  aria-label="Search profile"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                    <path d="m16 16 4.25 4.25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white shadow-[0_10px_24px_rgba(0,0,0,0.24)] backdrop-blur-sm transition hover:bg-black/50"
                  aria-label="More options"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                    <circle cx="5" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="19" cy="12" r="1.8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="relative -mt-24 bg-transparent">
          <div className="mx-auto w-full max-w-5xl">
            <div className="relative px-4 pb-5 pt-0 sm:px-6">
              <div className="absolute inset-x-0 bottom-0 top-20 bg-white sm:top-24" aria-hidden="true" />
              <div className="flex flex-col gap-4">
                <div className="relative flex items-end justify-between gap-4">
                  <div className="-mt-10 flex min-w-0 flex-1 items-end gap-4 sm:-mt-12">
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-[5px] border-white bg-slate-100 text-2xl font-semibold text-slate-700 shadow-[0_12px_24px_rgba(15,23,42,0.18)] sm:h-32 sm:w-32">
                      <div className="h-full w-full overflow-hidden rounded-full bg-slate-100">
                        {avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <span>{extractInitials(displayName)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="min-w-0 pb-1 pt-16 sm:pt-20">
                      <div className="flex items-center gap-2">
                        <h1 className="truncate text-[28px] font-semibold tracking-[-0.04em] text-slate-900 sm:text-[34px]">{displayName}</h1>
                        {profile?.verified ? (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#1d9bf0] text-white" aria-label="Verified" title="Verified">
                            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
                              <path d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.12 7.18a1 1 0 0 1-1.42.006L3.29 9.01a1 1 0 1 1 1.414-1.414l3.17 3.17 6.412-6.47a1 1 0 0 1 1.418-.006z" fill="currentColor" />
                            </svg>
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-[15px] font-medium text-slate-500">{profileHandle}</div>
                      <div className="mt-2 text-[15px] font-medium text-slate-500">
                        {roleLabel(profile?.role)}
                        {gradeLabel ? ` • ${gradeLabel}` : ''}
                        {profile?.schoolName ? ` • ${profile.schoolName}` : ''}
                      </div>
                    </div>
                  </div>

                  {profileLoading ? null : isSelf ? (
                    <button type="button" className="inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
                      Edit profile
                    </button>
                  ) : canFollow ? (
                    <button
                      type="button"
                      className={`inline-flex h-10 shrink-0 items-center justify-center rounded-full px-5 text-sm font-semibold transition ${profile?.isFollowing ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                      onClick={() => void toggleFollow()}
                      disabled={followBusy}
                    >
                      {followBusy ? 'Working...' : profile?.isFollowing ? 'Following' : 'Follow'}
                    </button>
                  ) : null}
                </div>

                {profile?.statusBio ? <p className="relative max-w-3xl text-[15px] leading-7 text-slate-700">{profile?.statusBio}</p> : null}

                <div className="relative flex flex-wrap items-center gap-4 text-[14px] font-medium text-slate-500">
                  <span><span className="font-semibold text-slate-900">{Number(profile?.followingCount || 0)}</span> Following</span>
                  <span><span className="font-semibold text-slate-900">{Number(profile?.followerCount || 0)}</span> Followers</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto w-full max-w-5xl">
        <section className="border-t border-slate-200 bg-white px-4 pt-3 sm:px-6">
          <div className="flex items-center gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(['all', 'photos', 'reels'] as ProfileTab[]).map((tab) => {
              const active = activeTab === tab
              const label = tab === 'all' ? 'Posts' : tab === 'photos' ? 'Sessions' : 'Notes'
              return (
                <button
                  key={tab}
                  type="button"
                  className={`relative shrink-0 px-4 py-3 text-[15px] font-semibold tracking-[-0.02em] transition ${active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {label}
                  {active ? <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-[#1d9bf0]" aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>
        </section>

        <section className="px-4 pt-2 sm:px-6">
          <div className="flex gap-5 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(discoverProfiles.length > 0 ? discoverProfiles : []).map((item) => {
              const suggestionAvatar = resolveImageUrl(item.avatar)
              return (
                <Link key={item.id} href={`/u/${encodeURIComponent(item.id)}`} className="block min-w-[9rem] max-w-[9rem] text-left">
                  <div className="overflow-hidden rounded-[28px] bg-transparent">
                    <div className="mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white text-lg font-semibold text-slate-700 shadow-[0_12px_22px_rgba(15,23,42,0.08)]">
                      {suggestionAvatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={suggestionAvatar} alt={item.name} className="h-full w-full object-cover" />
                      ) : (
                        <span>{extractInitials(item.name)}</span>
                      )}
                    </div>
                    <div className="mt-3 text-[15px] font-semibold tracking-[-0.03em] text-slate-900">{item.name}</div>
                    {item.sharedGroupsCount ? <div className="mt-1 text-[12px] leading-5 text-slate-500">{item.sharedGroupsCount} shared groups</div> : <div className="mt-1 text-[12px] leading-5 text-slate-500">{item.schoolName || roleLabel(item.role)}</div>}
                  </div>
                </Link>
              )
            })}
            {!discoverLoading && discoverProfiles.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/80 px-4 py-5 text-sm text-slate-500">No profile suggestions yet.</div>
            ) : null}
          </div>
        </section>

        <section className="px-4 pt-6 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-[26px] font-semibold tracking-[-0.05em] text-slate-900">{isSelf ? 'All posts' : `${firstName}'s posts`}</h2>
            <button
              type="button"
              className="text-[17px] font-semibold tracking-[-0.03em] text-[#1463cc]"
              onClick={() => setActiveTab('all')}
            >
              Filters
            </button>
          </div>

          {isSelf ? (
            <div className="mt-5 overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_16px_34px_rgba(15,23,42,0.08)]">
              <div className="flex items-center gap-4 px-5 py-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-700">
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                  ) : (
                    <span>{extractInitials(displayName)}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 rounded-full bg-slate-50 px-4 py-3 text-[16px] font-medium tracking-[-0.02em] text-slate-800">What's on your mind?</div>
                <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#2fb344] transition hover:bg-[#effaf2]" aria-label="Add photo">
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden="true">
                    <path d="M6.5 5A3.5 3.5 0 0 0 3 8.5v7A3.5 3.5 0 0 0 6.5 19h11a3.5 3.5 0 0 0 3.5-3.5v-7A3.5 3.5 0 0 0 17.5 5h-2.59l-.7-1.05A2 2 0 0 0 12.54 3h-1.08a2 2 0 0 0-1.67.95L9.09 5H6.5Zm5.5 3.25A4.25 4.25 0 1 1 7.75 12 4.25 4.25 0 0 1 12 8.25Zm0 1.5A2.75 2.75 0 1 0 14.75 12 2.75 2.75 0 0 0 12 9.75Z" />
                  </svg>
                </button>
              </div>
              <div className="border-t border-slate-100 px-5 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-[15px] font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50">
                    <span className="text-[#ff5a5f]">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true"><path d="M4 7.75A2.75 2.75 0 0 1 6.75 5h10.5A2.75 2.75 0 0 1 20 7.75v8.5A2.75 2.75 0 0 1 17.25 19H6.75A2.75 2.75 0 0 1 4 16.25v-8.5Zm4.5 1.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm7.72.22-5.47 5.47-2.22-2.22L5.5 15.75h13l-2.28-6.28Z" /></svg>
                    </span>
                    Reel
                  </button>
                  <button type="button" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-[15px] font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50">
                    <span className="text-[#ff4b4b]">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true"><path d="M17.5 6A2.5 2.5 0 0 1 20 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 15.5v-7A2.5 2.5 0 0 1 6.5 6h11Zm-8 3.25v5.5L15 12l-5.5-2.75Z" /></svg>
                    </span>
                    Live
                  </button>
                </div>
              </div>
            </div>
          ) : canFollow ? (
            <div className="mt-5 overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_16px_34px_rgba(15,23,42,0.08)]">
              <div className="flex items-center gap-4 px-5 py-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-700">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                  ) : (
                    <span>{extractInitials(displayName)}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 rounded-full bg-slate-50 px-4 py-3 text-[16px] font-medium tracking-[-0.02em] text-slate-800">Post a challenge to {firstName}</div>
                <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#2fb344] transition hover:bg-[#effaf2]" aria-label={`Post a challenge to ${firstName}`}>
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden="true">
                    <path d="M6.5 5A3.5 3.5 0 0 0 3 8.5v7A3.5 3.5 0 0 0 6.5 19h11a3.5 3.5 0 0 0 3.5-3.5v-7A3.5 3.5 0 0 0 17.5 5h-2.59l-.7-1.05A2 2 0 0 0 12.54 3h-1.08a2 2 0 0 0-1.67.95L9.09 5H6.5Zm5.5 3.25A4.25 4.25 0 1 1 7.75 12 4.25 4.25 0 0 1 12 8.25Zm0 1.5A2.75 2.75 0 1 0 14.75 12 2.75 2.75 0 0 0 12 9.75Z" />
                  </svg>
                </button>
              </div>
            </div>
          ) : null}

          {isSelf ? (
            <div className="mt-5">
              <button type="button" className="inline-flex w-full items-center justify-center gap-2 rounded-[22px] border border-slate-200 bg-slate-100 px-5 py-4 text-[17px] font-semibold tracking-[-0.03em] text-slate-900 shadow-sm transition hover:bg-slate-200">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                  <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H11l-4.5 3v-3H6.5A2.5 2.5 0 0 1 4 13.5v-7Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Manage posts
              </button>
            </div>
          ) : null}
        </section>

        <section className="space-y-5 px-4 pb-8 pt-6 sm:px-6">
          {profileLoading ? <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">Loading profile...</div> : null}
          {profileError ? <div className="rounded-[24px] border border-red-200 bg-red-50 px-5 py-8 text-center text-sm text-red-700 shadow-[0_14px_30px_rgba(220,38,38,0.08)]">{profileError}</div> : null}

          {!profileLoading && !profileError && activeTab === 'all' ? (
            postsLoading ? <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">Loading posts...</div> : postsError ? <div className="rounded-[24px] border border-red-200 bg-red-50 px-5 py-8 text-center text-sm text-red-700 shadow-[0_14px_30px_rgba(220,38,38,0.08)]">{postsError}</div> : posts.length === 0 ? <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">No posts yet.</div> : posts.map(renderPostCard)
          ) : null}

          {!profileLoading && !profileError && activeTab === 'photos' ? renderPhotoGrid() : null}
          {!profileLoading && !profileError && activeTab === 'reels' ? renderReels() : null}
        </section>
        </div>
      </div>

      <PostReplyComposerOverlays
        modeOverlay={postSolveModeOverlay}
        canvasOverlay={postSolveOverlay}
        typedOverlay={postTypedSolveOverlay}
        blocks={postSolveBlocks}
        draftText={postSolveText}
        editingTarget={postSolveEditingTarget}
        crudTarget={composerBlockCrudTarget}
        typedLatex={postTypedSolveLatex}
        typedChromeVisible={postTypedOverlayChromeVisible}
        isMobile={isMobile}
        viewerId={currentViewerId}
        viewerName={currentViewerName}
        gradeLabel={activeGradeLabel}
        roleProfile={currentLessonRoleProfile}
        submitting={postSolveSubmitting}
        imageUploading={postReplyImageUploading}
        imageSourceSheetOpen={postReplyImageSourceSheetOpen}
        imageEditOpen={postReplyImageEditOpen}
        imageEditFile={postReplyImageEditFile}
        error={postSolveError}
        cameraInputRef={postReplyCameraInputRef}
        galleryInputRef={postReplyGalleryInputRef}
        textareaRef={postSolveTextareaRef}
        onDraftTextChange={setPostSolveText}
        onTypedLatexChange={setPostTypedSolveLatex}
        onCloseModeOverlay={() => {
          setPostSolveModeOverlay(null)
          setPostSolveError(null)
          setPostReplyImageSourceSheetOpen(false)
          setPostSolveEditingTarget(null)
          setComposerBlockCrudTarget(null)
        }}
        onCloseBlockCrud={() => setComposerBlockCrudTarget(null)}
        onOpenTyped={() => openTypedPostSolveComposer(postSolveModeOverlay, 'keyboard')}
        onOpenHandwritten={() => openHandwrittenPostSolveComposer(postSolveModeOverlay)}
        onOpenImagePicker={openPostReplyImagePicker}
        onSubmitText={() => void submitPostTextSolve()}
        onImagePicked={onPostReplyImagePicked}
        onCloseImageSourceSheet={() => setPostReplyImageSourceSheetOpen(false)}
        onOpenCameraPicker={openPostReplyCameraPicker}
        onOpenGalleryPicker={openPostReplyGalleryPicker}
        onCancelImageEdit={closePostReplyImageEdit}
        onConfirmImageEdit={(file) => void confirmPostReplyImageEdit(file)}
        onCanvasCancel={() => {
          if (postSolveSubmitting) return
          setPostSolveModeOverlay(postSolveOverlay ? {
            ...postSolveOverlay,
            initialStudentText: '',
          } : null)
          setPostSolveOverlay(null)
          setPostSolveEditingTarget((current) => current?.type === 'canvas' ? null : current)
          setPostSolveError(null)
        }}
        onCanvasSubmit={(scene) => void submitPostSolve(scene)}
        onTypedClose={() => {
          if (postSolveSubmitting) return
          setPostSolveModeOverlay(postTypedSolveOverlay ? {
            ...postTypedSolveOverlay,
            initialLatex: '',
            initialStudentText: '',
          } : null)
          setPostTypedSolveOverlay(null)
          setPostTypedOverlayChromeVisible(false)
          setPostSolveEditingTarget((current) => current?.type === 'latex' ? null : current)
          setPostSolveError(null)
        }}
        onSubmitTyped={() => void submitTypedPostSolve()}
        onTypedChromeVisibilityChange={setPostTypedOverlayChromeVisible}
        onEditBlock={editComposerBlock}
        onDeleteBlock={deleteComposerBlock}
        onBeginBlockLongPress={beginComposerBlockLongPress}
        onMoveBlockLongPress={moveComposerBlockLongPress}
        onClearBlockLongPress={clearComposerBlockLongPress}
        onOpenBlockCrudOptions={openComposerBlockCrudOptions}
      />

      {postThreadOverlay ? (
        <FullScreenGlassOverlay
          title={postThreadOverlay.title || 'Solutions'}
          subtitle="Public solutions thread"
          zIndexClassName="z-[67]"
          onClose={() => {
            setPostThreadOverlay(null)
            setPostThreadError(null)
            setPostThreadResponses([])
          }}
          onBackdropClick={() => {
            setPostThreadOverlay(null)
            setPostThreadError(null)
            setPostThreadResponses([])
          }}
          rightActions={postThreadResponses.some((response: any) => String(response?.userId || '') === currentViewerId) ? null : (
            <button type="button" className="btn btn-primary" onClick={() => {
              const targetPost = posts.find((post) => String(post?.id || '') === String(postThreadOverlay.postId || ''))
              if (targetPost) void openLocalPostSolveComposer(targetPost)
            }}>
              Share solution
            </button>
          )}
        >
          <div className="space-y-4">
            {postThreadOverlay.prompt ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">{postThreadOverlay.prompt}</div>
            ) : null}
            {postThreadOverlay.imageUrl ? (
              <button
                type="button"
                className="block w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left"
                onClick={() => openImageViewer(postThreadOverlay.imageUrl as string, `${postThreadOverlay.title || 'Post'} image`)}
              >
                <img src={postThreadOverlay.imageUrl} alt="Post attachment" className="max-h-[320px] w-full object-contain" />
              </button>
            ) : null}
            {postThreadError ? (
              <div className="rounded-2xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{postThreadError}</div>
            ) : postThreadLoading ? (
              <div className="text-sm text-white/70">Loading solutions...</div>
            ) : postThreadResponses.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-white/70">No solutions yet.</div>
            ) : (
              <div className="space-y-3">
                {postThreadResponses.map((response: any) => {
                  const responseUserName = String(response?.user?.name || response?.user?.email || 'Learner')
                  const responseUserId = response?.user?.id ? String(response.user.id) : null
                  const responseAvatar = String(response?.user?.avatar || response?.userAvatar || '').trim()
                  const postReplyBlocks = normalizePostReplyBlocks(response)

                  return (
                    <div key={String(response?.id || Math.random())} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-start gap-3">
                        <UserLink userId={responseUserId} className="shrink-0" title="View profile">
                          <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/10">
                            {responseAvatar ? (
                              <img src={responseAvatar} alt={responseUserName} className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-[11px] font-semibold text-white">{responseUserName.slice(0, 1).toUpperCase()}</span>
                            )}
                          </div>
                        </UserLink>
                        <div className="min-w-0 flex-1">
                          <UserLink userId={responseUserId} className="text-sm font-semibold text-white hover:underline" title="View profile">
                            {responseUserName}
                          </UserLink>
                          <div className="mt-2 min-w-0 rounded-[20px] text-white/90">
                            {postReplyBlocks.length > 0 ? (
                              renderProfilePostReplyBlocks(postReplyBlocks, `profile-post-thread-${String(response?.id || 'draft')}`, {
                                onOpenImageBlock: (imageUrl) => openImageViewer(imageUrl, `${responseUserName} attachment`),
                              })
                            ) : (
                              <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-sm text-white/70">No canvas attached.</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </FullScreenGlassOverlay>
      ) : null}

      {imageViewer ? (
        <ZoomableImageOverlay
          open={Boolean(imageViewer)}
          imageUrl={imageViewer.url}
          title={imageViewer.title}
          onClose={closeImageViewer}
        />
      ) : null}
    </main>
  )
}

export const getServerSideProps: GetServerSideProps = async () => {
  return { props: {} }
}
