import { useSession } from 'next-auth/react'
import type { GetServerSideProps } from 'next'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react'
import AccountControlOverlay from '../../components/AccountControlOverlay'
import BottomSheet from '../../components/BottomSheet'
import FeedComposerPill from '../../components/FeedComposerPill'
import FullScreenGlassOverlay from '../../components/FullScreenGlassOverlay'
import ImageCropperModal from '../../components/ImageCropperModal'
import InlinePostSolutionsThread from '../../components/InlinePostSolutionsThread'
import OverlayPortal from '../../components/OverlayPortal'
import OwnPostsManagerOverlay from '../../components/OwnPostsManagerOverlay'
import PostComposerOverlay from '../../components/PostComposerOverlay'
import PostCrudBottomSheet from '../../components/PostCrudBottomSheet'
import PublicFeedPostCard from '../../components/PublicFeedPostCard'
import PostReplyComposerOverlays from '../../components/PostReplyComposerOverlays'
import ReplyCrudBottomSheet from '../../components/ReplyCrudBottomSheet'
import { PublicSolveCanvasViewer, normalizePublicSolveScene, type PublicSolveScene } from '../../components/PublicSolveCanvas'
import UserLink from '../../components/UserLink'
import ZoomableImageOverlay from '../../components/ZoomableImageOverlay'
import { applyOwnFeedPostResponse, buildFeedPostActionState, syncFeedPostThreadState, type FeedPost } from '../../lib/feedContract'
import { gradeToLabel } from '../../lib/grades'
import { renderKatexDisplayHtml } from '../../lib/latexRender'
import { createLessonRoleProfile, normalizePlatformRole } from '../../lib/lessonAccessControl'
import { buildHydratedCreatedPost, patchFeedPost, removeFeedPost, sortFeedPostsByCreatedAt, type PostComposerAudience } from '../../lib/postComposerShared'
import { buildSocialPostComposerFields } from '../../lib/postComposerContent'
import { usePostLongPressCrud, type PostCrudTarget } from '../../lib/postCrud'
import { renderTextWithKatex } from '../../lib/renderTextWithKatex'
import { useReplyLongPressCrud, type ReplyCrudTarget } from '../../lib/replyCrud'
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

type ProfileTab = 'all' | 'photos' | 'reels'

export type PublicUserProfileSurfaceProps = {
  userId?: string
  embedded?: boolean
  dashboardEmbed?: boolean
  onBack?: () => void
  onAvatarChange?: (url: string | null) => void
  onCoverChange?: (url: string | null) => void
}

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

export function PublicUserProfileSurface({
  userId: userIdProp,
  embedded: embeddedProp,
  dashboardEmbed: dashboardEmbedProp,
  onBack,
  onAvatarChange,
  onCoverChange,
}: PublicUserProfileSurfaceProps = {}) {
  const router = useRouter()
  const { status, data: session, update: updateSession } = useSession()
  const pageRootRef = useRef<HTMLElement | null>(null)

  const userId = typeof userIdProp === 'string'
    ? userIdProp
    : typeof router.query?.id === 'string'
      ? router.query.id
      : ''
  const isEmbedded = typeof embeddedProp === 'boolean'
    ? embeddedProp
    : typeof router.query?.embedded === 'string' && router.query.embedded === '1'
  const isDashboardEmbed = typeof dashboardEmbedProp === 'boolean'
    ? dashboardEmbedProp
    : isEmbedded && typeof router.query?.dashboard === 'string' && router.query.dashboard === '1'

  const [profile, setProfile] = useState<PublicUser | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [posts, setPosts] = useState<ProfilePost[]>([])
  const [postsLoading, setPostsLoading] = useState(false)
  const [postsError, setPostsError] = useState<string | null>(null)

  const [challenges, setChallenges] = useState<ProfileChallenge[]>([])
  const [challengesLoading, setChallengesLoading] = useState(false)

  const [postComposerOpen, setPostComposerOpen] = useState(false)
  const [editingOwnedPostId, setEditingOwnedPostId] = useState<string | null>(null)
  const [postAudienceDraft, setPostAudienceDraft] = useState<PostComposerAudience>('public')
  const [postTitleDraft, setPostTitleDraft] = useState('')
  const [postMaxAttemptsDraft, setPostMaxAttemptsDraft] = useState<string>('unlimited')
  const [postParseOnUpload, setPostParseOnUpload] = useState(false)
  const [postParsedJsonText, setPostParsedJsonText] = useState<string | null>(null)
  const [postParsedOpen, setPostParsedOpen] = useState(false)
  const [postPosting, setPostPosting] = useState(false)
  const [postDeleting, setPostDeleting] = useState(false)
  const [ownPostsManagerOpen, setOwnPostsManagerOpen] = useState(false)

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
  const [replyCrudTarget, setReplyCrudTarget] = useState<ReplyCrudTarget | null>(null)
  const [postCrudTarget, setPostCrudTarget] = useState<PostCrudTarget<ProfilePost> | null>(null)
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
  const [profileEditSheetOpen, setProfileEditSheetOpen] = useState(false)
  const [profileMediaSheetTarget, setProfileMediaSheetTarget] = useState<null | 'avatar' | 'cover'>(null)
  const [accountControlOpen, setAccountControlOpen] = useState(false)
  const [avatarUploadError, setAvatarUploadError] = useState<string | null>(null)
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [coverUploading, setCoverUploading] = useState(false)
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null)
  const [coverCropFile, setCoverCropFile] = useState<File | null>(null)
  const composerBlockLongPressTimeoutRef = useRef<number | null>(null)
  const composerBlockLongPressStateRef = useRef<null | { x: number; y: number; target: ComposerBlockCrudTarget }>(null)
  const composerBlockLongPressOpenedRef = useRef(false)
  const postReplyCameraInputRef = useRef<HTMLInputElement | null>(null)
  const postReplyGalleryInputRef = useRef<HTMLInputElement | null>(null)
  const postSolveTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const coverInputRef = useRef<HTMLInputElement | null>(null)

  const sessionPlatformRole = normalizePlatformRole((session as any)?.user?.role)
  const currentLessonRoleProfile = useMemo(() => createLessonRoleProfile({ platformRole: sessionPlatformRole }), [sessionPlatformRole])
  const currentViewerId = String(viewerId || (session as any)?.user?.id || '')
  const currentViewerName = String(session?.user?.name || session?.user?.email || 'You')
  const currentViewerAvatarUrl = resolveImageUrl(String((session as any)?.user?.avatar || (session as any)?.user?.image || '')) || null
  const currentViewerFirstName = useMemo(() => String(currentViewerName || '').trim().split(/\s+/).filter(Boolean)[0] || 'You', [currentViewerName])
  const {
    clearLongPress: clearReplyLongPress,
    openCrudOptions: openReplyCrudOptions,
    beginLongPress: beginReplyLongPress,
    moveLongPress: moveReplyLongPress,
  } = useReplyLongPressCrud<ReplyCrudTarget>({
    currentUserId: currentViewerId,
    onOpenCrud: setReplyCrudTarget,
  })
  const {
    clearLongPress: clearPostLongPress,
    openCrudOptions: openPostCrudOptions,
    beginLongPress: beginPostLongPress,
    moveLongPress: movePostLongPress,
    consumeLongPressOpen: consumePostLongPressOpen,
    isOwnedByCurrentUser: isOwnedPostByCurrentUser,
  } = usePostLongPressCrud<PostCrudTarget<ProfilePost>>({
    currentUserId: currentViewerId,
    onOpenCrud: setPostCrudTarget,
  })
  const activeGradeLabel = useMemo(() => {
    const rawGrade = typeof (session as any)?.user?.grade === 'string' ? (session as any).user.grade : ''
    return rawGrade ? gradeToLabel(rawGrade as any) : null
  }, [session])

  const closeOwnedPostComposer = useCallback(() => {
    setPostComposerOpen(false)
    setEditingOwnedPostId(null)
    setPostSolveBlocks([])
    setPostSolveText('')
    setPostTypedSolveLatex('')
    setPostSolveEditingTarget(null)
    setComposerBlockCrudTarget(null)
    setPostTypedSolveOverlay(null)
    setPostSolveOverlay(null)
    setPostTypedOverlayChromeVisible(false)
    setPostReplyImageSourceSheetOpen(false)
    setPostReplyImageEditOpen(false)
    setPostReplyImageEditFile(null)
    setPostParsedJsonText(null)
    setPostParsedOpen(false)
  }, [])

  const requestDashboardCreatePostComposer = useCallback((mode: 'post' | 'screenshot' = 'post') => {
    if (!isDashboardEmbed) return false
    if (typeof window === 'undefined') return false
    if (window.parent === window) return false
    window.parent.postMessage({
      type: mode === 'screenshot' ? 'pa:embedded-profile-open-post-screenshot' : 'pa:embedded-profile-open-post-composer',
      userId,
    }, window.location.origin)
    return true
  }, [isDashboardEmbed, userId])

  const openCreateOwnedPostComposer = useCallback(() => {
    if (requestDashboardCreatePostComposer('post')) return
    setEditingOwnedPostId(null)
    setPostSolveBlocks([])
    setPostSolveText('')
    setPostTypedSolveLatex('')
    setPostSolveEditingTarget(null)
    setComposerBlockCrudTarget(null)
    setPostTypedSolveOverlay(null)
    setPostSolveOverlay(null)
    setPostTypedOverlayChromeVisible(false)
    setPostReplyImageSourceSheetOpen(false)
    setPostReplyImageEditOpen(false)
    setPostReplyImageEditFile(null)
    setPostParsedJsonText(null)
    setPostParsedOpen(false)
    setPostComposerOpen(true)
  }, [requestDashboardCreatePostComposer])

  const openCreateOwnedPostScreenshotPicker = useCallback(() => {
    if (requestDashboardCreatePostComposer('screenshot')) return
    openCreateOwnedPostComposer()
    setPostReplyImageSourceSheetOpen(true)
  }, [openCreateOwnedPostComposer, requestDashboardCreatePostComposer])

  const openEditOwnedPostComposer = useCallback((post: ProfilePost) => {
    const id = post?.id ? String(post.id) : ''
    if (!id) return
    const audienceRaw = typeof post?.audience === 'string' ? post.audience : 'public'
    const audience = (audienceRaw === 'public' || audienceRaw === 'grade' || audienceRaw === 'private') ? audienceRaw : 'public'
    setEditingOwnedPostId(id)
    setPostTitleDraft(String(post?.title || ''))
    setPostAudienceDraft(audience)
    setPostMaxAttemptsDraft(typeof post?.maxAttempts === 'number' ? String(post.maxAttempts) : 'unlimited')
    setPostSolveBlocks(normalizePostReplyBlocks((post as any)?.contentBlocks || { studentText: post?.prompt, imageUrl: post?.imageUrl }))
    setPostSolveText('')
    setPostTypedSolveLatex('')
    setPostSolveEditingTarget(null)
    setComposerBlockCrudTarget(null)
    setPostTypedSolveOverlay(null)
    setPostSolveOverlay(null)
    setPostTypedOverlayChromeVisible(false)
    setPostReplyImageSourceSheetOpen(false)
    setPostReplyImageEditOpen(false)
    setPostReplyImageEditFile(null)
    setPostParsedJsonText(null)
    setPostParsedOpen(false)
    setPostComposerOpen(true)
  }, [])

  const submitOwnedPost = useCallback(async () => {
    if (status !== 'authenticated') return

    const title = postTitleDraft.trim()
    const structuredFields = buildSocialPostComposerFields(composePostSolveBlocksWithDraftText(postSolveBlocks, String(postSolveText || ''), postSolveEditingTarget))
    if (structuredFields.contentBlocks.length === 0) {
      alert('Please add content before posting.')
      return
    }

    const rawGrade = typeof (session as any)?.user?.grade === 'string' ? (session as any).user.grade : null
    const maxAttempts = postMaxAttemptsDraft === 'unlimited' ? null : parseInt(postMaxAttemptsDraft, 10)
    const isEditing = Boolean(editingOwnedPostId)
    const endpoint = isEditing
      ? `/api/posts/${encodeURIComponent(String(editingOwnedPostId))}`
      : '/api/posts'

    setPostPosting(true)
    try {
      const res = await fetch(endpoint, {
        method: isEditing ? 'PATCH' : 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          prompt: structuredFields.storedPrompt,
          imageUrl: structuredFields.primaryImageUrl,
          contentBlocks: structuredFields.contentBlocks,
          audience: postAudienceDraft,
          maxAttempts,
          ...(isEditing ? {} : { grade: rawGrade }),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.message || `Failed to ${isEditing ? 'save' : 'post'} (${res.status})`)
        return
      }

      if (isEditing && editingOwnedPostId) {
        const patch = {
          title,
          prompt: structuredFields.storedPrompt,
          imageUrl: structuredFields.primaryImageUrl,
          contentBlocks: structuredFields.contentBlocks,
          audience: postAudienceDraft,
          maxAttempts,
        }
        setPosts((current) => Array.isArray(current)
          ? current.map((item) => patchFeedPost(item, editingOwnedPostId, patch))
          : current)
      } else {
        const createdItem = buildHydratedCreatedPost(data, session, currentViewerId, rawGrade)
        setPosts((current) => sortFeedPostsByCreatedAt([
          createdItem,
          ...(Array.isArray(current) ? current.filter((item) => String(item?.id || '') !== String(createdItem.id || '')) : []),
        ]))
        setActiveTab('all')
      }

      closeOwnedPostComposer()
      setPostTitleDraft('')
      setPostAudienceDraft('public')
      setPostMaxAttemptsDraft('unlimited')
      setPostParsedJsonText(null)
      setPostParsedOpen(false)
      alert(isEditing ? 'Saved' : 'Posted')
    } catch (err: any) {
      alert(err?.message || `Failed to ${editingOwnedPostId ? 'save' : 'post'}`)
    } finally {
      setPostPosting(false)
    }
  }, [closeOwnedPostComposer, currentViewerId, editingOwnedPostId, postAudienceDraft, postMaxAttemptsDraft, postSolveBlocks, postSolveEditingTarget, postSolveText, postTitleDraft, session, status])

  const deleteOwnedPost = useCallback(async (postId: string) => {
    const id = String(postId || '')
    if (!id) return
    const ok = typeof window !== 'undefined'
      ? window.confirm('Delete this post? This will remove it from your timeline and delete its public solutions thread.')
      : false
    if (!ok) return

    setPostDeleting(true)
    try {
      const res = await fetch(`/api/posts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data?.message || `Failed to delete (${res.status})`)
        return
      }
      setPosts((current) => removeFeedPost(current, id))
      setExpandedProfilePostId((current) => current === id ? null : current)
      setPostThreadOverlay((current) => current?.postId === id ? null : current)
      alert('Deleted')
    } catch (err: any) {
      alert(err?.message || 'Failed to delete')
    } finally {
      setPostDeleting(false)
    }
  }, [])

  const buildPostCrudTarget = useCallback((post: ProfilePost): PostCrudTarget<ProfilePost> => ({ post }), [])

  const getPostCrudBodyProps = useCallback((post: ProfilePost) => {
    const target = buildPostCrudTarget(post)
    return {
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => beginPostLongPress(event, target),
      onPointerMove: movePostLongPress,
      onPointerUp: clearPostLongPress,
      onPointerCancel: clearPostLongPress,
      onPointerLeave: clearPostLongPress,
      onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => {
        if (!isOwnedPostByCurrentUser(target)) return
        event.preventDefault()
        openPostCrudOptions(target)
      },
    }
  }, [beginPostLongPress, buildPostCrudTarget, clearPostLongPress, isOwnedPostByCurrentUser, movePostLongPress, openPostCrudOptions])

  const getOwnPostManagerContentProps = useCallback((post: FeedPost) => {
    const target = buildPostCrudTarget(post as ProfilePost)
    return {
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => beginPostLongPress(event, target),
      onPointerMove: movePostLongPress,
      onPointerUp: clearPostLongPress,
      onPointerCancel: clearPostLongPress,
      onPointerLeave: clearPostLongPress,
      onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => {
        if (!isOwnedPostByCurrentUser(target)) return
        event.preventDefault()
        openPostCrudOptions(target)
      },
    }
  }, [beginPostLongPress, buildPostCrudTarget, clearPostLongPress, isOwnedPostByCurrentUser, movePostLongPress, openPostCrudOptions])

  const consumePostLongPressForPost = useCallback((post: ProfilePost) => {
    return consumePostLongPressOpen(buildPostCrudTarget(post))
  }, [buildPostCrudTarget, consumePostLongPressOpen])

  const editPostFromCrudTarget = useCallback((target: PostCrudTarget<ProfilePost>) => {
    setPostCrudTarget(null)
    openEditOwnedPostComposer(target.post)
  }, [openEditOwnedPostComposer])

  const deletePostFromCrudTarget = useCallback(async (target: PostCrudTarget<ProfilePost>) => {
    setPostCrudTarget(null)
    await deleteOwnedPost(String(target?.post?.id || ''))
  }, [deleteOwnedPost])

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
      if (postComposerOpen && postParseOnUpload) form.append('parse', '1')
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
      if (postComposerOpen && postParseOnUpload) {
        const parsed = data?.parsed
        const parseErr = typeof data?.parseError === 'string' ? data.parseError.trim() : ''
        if (parsed) {
          setPostParsedJsonText(JSON.stringify(parsed, null, 2))
          setPostParsedOpen(true)
        } else if (parseErr) {
          setPostParsedJsonText(parseErr)
          setPostParsedOpen(true)
        } else {
          setPostParsedJsonText(null)
          setPostParsedOpen(false)
        }

        const parsedPrompt = typeof data?.parsedPrompt === 'string' ? data.parsedPrompt.trim() : ''
        if (parsedPrompt) {
          setPostSolveText((current) => (String(current || '').trim() ? current : parsedPrompt))
        }
      }
      setPostSolveError(null)
    } finally {
      setPostReplyImageUploading(false)
    }
  }, [postComposerOpen, postParseOnUpload])

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
    setPosts((prev) => Array.isArray(prev) ? prev.map((item) => applyOwnFeedPostResponse(item, draft.postId, responseData)) : prev)
  }, [])

  const syncProfilePostThreadState = useCallback((postId: string, responses: any[]) => {
    const safePostId = String(postId || '')
    if (!safePostId) return
    setPosts((prev) => Array.isArray(prev)
      ? prev.map((item) => syncFeedPostThreadState(item, safePostId, responses, currentViewerId))
      : prev)
  }, [currentViewerId])

  const buildPostReplyCrudTarget = useCallback((post: ProfilePost, response: any): ReplyCrudTarget => ({
    kind: 'post',
    threadKey: typeof post?.threadKey === 'string' ? post.threadKey : `post:${String(post?.id || '')}`,
    item: post,
    response,
  }), [])

  const getPostReplyContainerProps = useCallback((post: ProfilePost, response: any, isMine: boolean) => {
    const target = buildPostReplyCrudTarget(post, response)
    return {
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => beginReplyLongPress(event, target),
      onPointerMove: moveReplyLongPress,
      onPointerUp: clearReplyLongPress,
      onPointerCancel: clearReplyLongPress,
      onPointerLeave: clearReplyLongPress,
      onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => {
        if (!isMine) return
        event.preventDefault()
        openReplyCrudOptions(target)
      },
    }
  }, [beginReplyLongPress, buildPostReplyCrudTarget, clearReplyLongPress, moveReplyLongPress, openReplyCrudOptions])

  const deleteReplyFromCrudTarget = useCallback(async (target: ReplyCrudTarget) => {
    const responseId = String(target?.response?.id || '')
    const threadKey = String(target?.threadKey || '')
    if (!responseId || !threadKey) return
    const ok = typeof window !== 'undefined' ? window.confirm('Delete this reply? This cannot be undone.') : false
    if (!ok) return

    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(threadKey)}/responses`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responseId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Failed to delete reply (${res.status})`)
      }

      setReplyCrudTarget(null)

      const responses = await fetchPublicThreadResponses(threadKey)
      setPostThreadResponses(responses)
      syncProfilePostThreadState(String(target?.item?.id || target?.item?.postId || ''), responses)
    } catch (err: any) {
      alert(err?.message || 'Failed to delete reply')
    }
  }, [fetchPublicThreadResponses, syncProfilePostThreadState])

  const editReplyFromCrudTarget = useCallback((target: ReplyCrudTarget) => {
    setReplyCrudTarget(null)
    if (target.kind !== 'post') return
    void openLocalPostSolveComposer(target.item, {
      initialScene: target?.response?.excalidrawScene || null,
      initialLatex: typeof target?.response?.latex === 'string' ? target.response.latex : '',
      initialStudentText: typeof target?.response?.studentText === 'string' ? target.response.studentText : '',
      initialGradingJson: target?.response?.gradingJson ?? null,
    })
  }, [openLocalPostSolveComposer])

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
    if (!activeDraft?.postId || !normalizedScene) return

    if (postComposerOpen) {
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
      setPostSolveError(null)
      return
    }

    if (!activeDraft.threadKey) return

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
  }, [postComposerOpen, postSolveEditingTarget, postSolveOverlay])

  const submitTypedPostSolve = useCallback(async () => {
    const activeDraft = postTypedSolveOverlay
    const latex = String(postTypedSolveLatex || '').trim()
    if (!activeDraft?.postId) return
    if (!latex) {
      setPostSolveError('Write a typed response before adding it.')
      return
    }
    setPostSolveBlocks((prev) => upsertPostReplyBlock(prev, { id: createPostReplyBlockId(), type: 'latex', latex }, postSolveEditingTarget, 'latex'))
    if (!postComposerOpen) {
      setPostSolveModeOverlay({
        ...activeDraft,
        initialLatex: '',
        initialStudentText: '',
      })
    }
    setPostTypedSolveOverlay(null)
    setPostTypedOverlayChromeVisible(false)
    setPostTypedSolveLatex('')
    setPostSolveEditingTarget(null)
    setPostSolveError(null)
  }, [postComposerOpen, postSolveEditingTarget, postTypedSolveLatex, postTypedSolveOverlay])

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
    const activeComposerDraft = postSolveModeOverlay || (postComposerOpen ? {
      postId: editingOwnedPostId || 'draft-post',
      threadKey: editingOwnedPostId ? `post:${editingOwnedPostId}` : 'post:draft-post',
      title: postTitleDraft || 'Post',
      prompt: String(postSolveText || '').trim(),
      imageUrl: null,
      authorName: currentViewerName,
      authorAvatarUrl: String((session as any)?.user?.avatar || (session as any)?.user?.image || ''),
      postContentBlocks: composePostSolveBlocksWithDraftText(postSolveBlocks, String(postSolveText || ''), postSolveEditingTarget),
    } : null)
    if (!activeComposerDraft) return
    const target: ComposerBlockEditTarget = { blockId: block.id, type: block.type, index }
    if (block.type === 'text') {
      setPostSolveEditingTarget(target)
      setPostSolveText(block.text)
      focusPostSolveTextarea()
      return
    }
    if (block.type === 'latex') {
      openTypedPostSolveComposer(activeComposerDraft, 'keyboard', { editTarget: target, initialLatex: block.latex })
      return
    }
    if (block.type === 'canvas') {
      openHandwrittenPostSolveComposer(activeComposerDraft, { editTarget: target })
      return
    }
    setImageViewer({ url: block.imageUrl, title: 'Reply attachment' })
  }, [composePostSolveBlocksWithDraftText, currentViewerName, editingOwnedPostId, focusPostSolveTextarea, openHandwrittenPostSolveComposer, openTypedPostSolveComposer, postComposerOpen, postSolveBlocks, postSolveEditingTarget, postSolveModeOverlay, postSolveText, session])

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

  const closeAccountControl = useCallback(() => {
    setAccountControlOpen(false)
    void loadProfile()
  }, [loadProfile])

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
    if (!isEmbedded) return
    if (typeof window === 'undefined') return
    if (window.parent === window) return

    const overlayPinnedToViewport = Boolean(
      postComposerOpen
      || postSolveModeOverlay
      || postSolveOverlay
      || postTypedSolveOverlay
      || postReplyImageSourceSheetOpen
      || postReplyImageEditOpen
      || composerBlockCrudTarget
    )

    const postHeight = () => {
      if (overlayPinnedToViewport) {
        let viewportHeight = window.innerHeight || 0
        try {
          if (window.parent !== window && typeof window.parent.innerHeight === 'number' && window.parent.innerHeight > 0) {
            viewportHeight = window.parent.innerHeight
          }
        } catch {
          // Ignore cross-context access issues and fall back to the embedded viewport height.
        }
        window.parent.postMessage({
          type: 'pa:embedded-profile-height',
          userId,
          height: Math.max(viewportHeight, 720),
        }, window.location.origin)
        return
      }

      const rootHeight = pageRootRef.current?.scrollHeight || 0
      const bodyHeight = document.body?.scrollHeight || 0
      const docHeight = document.documentElement?.scrollHeight || 0
      const height = Math.max(rootHeight, bodyHeight, docHeight)
      if (!height) return
      window.parent.postMessage({
        type: 'pa:embedded-profile-height',
        userId,
        height,
      }, window.location.origin)
    }

    const animationFrameId = window.requestAnimationFrame(postHeight)
    const timeoutId = window.setTimeout(postHeight, 120)
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => postHeight())
      : null

    if (resizeObserver && pageRootRef.current) {
      resizeObserver.observe(pageRootRef.current)
    }

    window.addEventListener('resize', postHeight)
    return () => {
      window.cancelAnimationFrame(animationFrameId)
      window.clearTimeout(timeoutId)
      window.removeEventListener('resize', postHeight)
      resizeObserver?.disconnect()
    }
  }, [
    composerBlockCrudTarget,
    isEmbedded,
    postComposerOpen,
    postReplyImageEditOpen,
    postReplyImageSourceSheetOpen,
    postSolveModeOverlay,
    postSolveOverlay,
    postThreadLoading,
    postThreadResponses.length,
    postTypedSolveOverlay,
    posts.length,
    userId,
  ])

  const displayName = profile?.name || 'Profile'
  const firstName = useMemo(() => String(displayName || '').trim().split(/\s+/).filter(Boolean)[0] || 'User', [displayName])
  const profileHandle = `@${displayName.replace(/[^a-zA-Z0-9]+/g, '').trim() || 'profile'}`
  const profileCoverAssetUrl = resolveImageUrl(profile?.profileCoverUrl)
  const profileThemeAssetUrl = resolveImageUrl(profile?.profileThemeBgUrl)
  const coverUrl = resolveImageUrl(profile?.profileCoverUrl) || resolveImageUrl(profile?.profileThemeBgUrl) || defaultMobileHeroBg
  const editableCoverUrl = profileCoverAssetUrl || profileThemeAssetUrl
  const avatarUrl = resolveImageUrl(profile?.avatar)
  const isSelf = Boolean(profile && viewerId && String(profile.id) === String(viewerId))
  const canFollow = Boolean(profile && viewerId && !isSelf)
  const gradeLabel = profile?.grade ? gradeToLabel(profile.grade as any) : null
  const avatarInitials = useMemo(() => extractInitials(displayName || currentViewerName || 'You'), [currentViewerName, displayName])

  const updateOwnProfileAvatar = useCallback((nextAvatarUrl: string | null) => {
    const nextAvatar = nextAvatarUrl || null
    setProfile((current) => (current ? { ...current, avatar: nextAvatar } : current))
    setPosts((current) => Array.isArray(current)
      ? current.map((post) => {
          const authorId = String((post as any)?.createdBy?.id || (post as any)?.createdById || '')
          const selfId = String(profile?.id || currentViewerId || '')
          if (!selfId || authorId !== selfId) return post
          return {
            ...post,
            createdBy: {
              ...((post as any)?.createdBy || {}),
              avatar: nextAvatar,
            },
          }
        })
      : current)
    onAvatarChange?.(nextAvatar)
  }, [currentViewerId, onAvatarChange, profile?.id])

  const updateOwnProfileCover = useCallback((nextCoverUrl: string | null) => {
    const nextCover = nextCoverUrl || null
    setProfile((current) => (current ? { ...current, profileCoverUrl: nextCover } : current))
    onCoverChange?.(nextCover)
  }, [onCoverChange])

  const openAvatarPicker = useCallback(() => {
    setAvatarUploadError(null)
    setProfileMediaSheetTarget(null)
    setProfileEditSheetOpen(false)
    if (avatarUploading) return
    avatarInputRef.current?.click()
  }, [avatarUploading])

  const openCoverPicker = useCallback(() => {
    setCoverUploadError(null)
    setProfileMediaSheetTarget(null)
    setProfileEditSheetOpen(false)
    if (coverUploading) return
    coverInputRef.current?.click()
  }, [coverUploading])

  const openProfileDetailsEditor = useCallback(() => {
    setProfileEditSheetOpen(false)
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      void router.push('/profile')
      return
    }
    setAccountControlOpen(true)
  }, [router])

  const handleAvatarSurfaceTap = useCallback(() => {
    if (!isSelf) return
    if (avatarUrl) {
      setProfileEditSheetOpen(false)
      setProfileMediaSheetTarget('avatar')
      return
    }
    openAvatarPicker()
  }, [avatarUrl, isSelf, openAvatarPicker])

  const handleCoverSurfaceTap = useCallback(() => {
    if (!isSelf) return
    if (editableCoverUrl) {
      setProfileEditSheetOpen(false)
      setProfileMediaSheetTarget('cover')
      return
    }
    openCoverPicker()
  }, [editableCoverUrl, isSelf, openCoverPicker])

  const onAvatarFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setAvatarUploadError('Please choose an image file.')
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      setAvatarUploadError('Please keep images under 4 MB.')
      return
    }
    setAvatarUploadError(null)
    setAvatarCropFile(file)
  }, [])

  const onCoverFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setCoverUploadError('Please choose an image file.')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setCoverUploadError('Please keep images under 8 MB.')
      return
    }
    setCoverUploadError(null)
    setCoverCropFile(file)
  }, [])

  const confirmAvatarCrop = useCallback(async (file: File) => {
    setAvatarCropFile(null)
    setAvatarUploading(true)
    setAvatarUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Failed to upload avatar (${res.status})`)
      }
      const nextAvatarUrl = typeof data?.url === 'string' ? data.url.trim() : ''
      if (!nextAvatarUrl) {
        throw new Error('Upload succeeded but returned no avatar URL')
      }
      updateOwnProfileAvatar(nextAvatarUrl)
      try {
        await updateSession?.({ image: nextAvatarUrl } as any)
      } catch {
        // ignore session refresh failures
      }
    } catch (err: any) {
      setAvatarUploadError(err?.message || 'Unable to upload avatar right now')
    } finally {
      setAvatarUploading(false)
    }
  }, [updateOwnProfileAvatar, updateSession])

  const confirmCoverCrop = useCallback(async (file: File) => {
    setCoverCropFile(null)
    setCoverUploading(true)
    setCoverUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/profile/cover', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Failed to upload background image (${res.status})`)
      }
      const nextCoverUrl = typeof data?.url === 'string' ? data.url.trim() : ''
      if (!nextCoverUrl) {
        throw new Error('Upload succeeded but returned no background URL')
      }
      updateOwnProfileCover(nextCoverUrl)
    } catch (err: any) {
      setCoverUploadError(err?.message || 'Unable to upload background image right now')
    } finally {
      setCoverUploading(false)
    }
  }, [updateOwnProfileCover])

  const removeAvatar = useCallback(async () => {
    const ok = typeof window !== 'undefined' ? window.confirm('Remove your profile photo?') : false
    if (!ok) return
    setAvatarUploading(true)
    setAvatarUploadError(null)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: '' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Failed to remove avatar (${res.status})`)
      }
      updateOwnProfileAvatar(null)
      try {
        await updateSession?.({ image: null } as any)
      } catch {
        // ignore session refresh failures
      }
      setProfileMediaSheetTarget(null)
    } catch (err: any) {
      setAvatarUploadError(err?.message || 'Unable to remove avatar right now')
    } finally {
      setAvatarUploading(false)
    }
  }, [updateOwnProfileAvatar, updateSession])

  const removeCover = useCallback(async () => {
    const ok = typeof window !== 'undefined' ? window.confirm('Remove your profile background image?') : false
    if (!ok) return
    setCoverUploading(true)
    setCoverUploadError(null)
    try {
      const shouldClearCover = Boolean(profileCoverAssetUrl)
      const res = await fetch('/api/profile', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shouldClearCover ? { profileCoverUrl: '' } : { profileThemeBgUrl: '' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.message || `Failed to remove background image (${res.status})`)
      }
      setProfile((current) => (current ? {
        ...current,
        profileCoverUrl: shouldClearCover ? null : current.profileCoverUrl,
        profileThemeBgUrl: shouldClearCover ? current.profileThemeBgUrl : null,
      } : current))
      onCoverChange?.(null)
      setProfileMediaSheetTarget(null)
    } catch (err: any) {
      setCoverUploadError(err?.message || 'Unable to remove background image right now')
    } finally {
      setCoverUploading(false)
    }
  }, [onCoverChange, profileCoverAssetUrl])

  const photoPosts = useMemo(
    () => posts.filter((post) => Boolean(resolveImageUrl(post.imageUrl))),
    [posts],
  )

  const reelItems = useMemo(
    () => challenges.filter((challenge) => Boolean(resolveImageUrl(challenge.imageUrl))),
    [challenges],
  )

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack()
      return
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
      return
    }
    void router.push('/dashboard?panel=discover')
  }, [onBack, router])

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
      <InlinePostSolutionsThread
        loading={postThreadLoading}
        error={postThreadError}
        responses={postThreadResponses}
        currentUserId={currentViewerId}
        getContainerProps={(response, args) => getPostReplyContainerProps(post, response, args.isMine)}
        onOpenImageBlock={(imageUrl, args) => openImageViewer(imageUrl, `${args.responseUserName} attachment`)}
      />
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
      <article key={post.id} data-post-id={postId || undefined} className="public-profile-feed-post bg-white py-3">
        <PublicFeedPostCard
          authorId={authorId}
          authorName={authorName}
          authorAvatar={authorAvatar}
          authorVerified={authorVerified}
          createdAt={formatShortDate(post.createdAt)}
          title={String(post.title || '').trim() || 'Post'}
          prompt={post.prompt || ''}
          imageUrl={resolveImageUrl(post.imageUrl)}
          contentBlocks={Array.isArray(post.contentBlocks) ? post.contentBlocks : null}
          expanded={isExpanded}
          onOpen={() => {
            if (consumePostLongPressForPost(post)) return
            void openLocalPostThread(post, { forceOpen: true })
          }}
          onOpenImage={openImageViewer}
          consumeLongPressOpen={() => consumePostLongPressForPost(post)}
          bodyPointerProps={getPostCrudBodyProps(post)}
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
    if (postsLoading) return <div className="public-profile-feed-message border-y border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">Loading photos...</div>
    if (photoPosts.length === 0) return <div className="public-profile-feed-message border-y border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">No photos yet.</div>
    return (
      <div className="grid grid-cols-2 gap-px bg-slate-200 sm:grid-cols-3">
        {photoPosts.map((post) => {
          const postImageUrl = resolveImageUrl(post.imageUrl)
          return (
            <button
              key={post.id}
              type="button"
              className="overflow-hidden bg-white"
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
    if (challengesLoading) return <div className="public-profile-feed-message border-y border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">Loading reels...</div>
    if (reelItems.length === 0) return <div className="public-profile-feed-message border-y border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">No reels yet.</div>
    return (
      <div className="public-profile-feed-list divide-y divide-slate-200 border-y border-slate-200 bg-white">
        {reelItems.map((item) => {
          const imageUrl = resolveImageUrl(item.imageUrl)
          return (
            <article key={item.id} className="overflow-hidden bg-white">
              <button type="button" className="block w-full text-left" onClick={() => openImageViewer(imageUrl, item.title || 'Reel')}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt={item.title || 'Reel'} className="max-h-[36rem] w-full object-cover" />
              </button>
              <div className="px-4 py-4 sm:px-6">
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
    <main ref={pageRootRef} className={`public-profile-page bg-[linear-gradient(180deg,#ffffff_0%,#f5f8fd_30%,#f7f8fb_100%)] text-slate-900 ${isEmbedded ? '' : 'min-h-screen'}`}>
      <div className={`${isEmbedded ? '' : 'min-h-screen'} pb-[calc(var(--app-safe-bottom)+2rem)]`}>
        <section className="public-profile-hero relative w-full overflow-hidden bg-slate-900">
          <div className="public-profile-hero__image pointer-events-none absolute inset-0" style={{ backgroundImage: `url("${coverUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} aria-hidden="true" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.42)_0%,rgba(0,0,0,0.18)_30%,rgba(0,0,0,0.32)_100%)]" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.7)_72%,#ffffff_100%)]" aria-hidden="true" />
          {isSelf ? (
            <button
              type="button"
              className="absolute inset-0 z-[1] bg-transparent"
              onClick={handleCoverSurfaceTap}
              aria-label={editableCoverUrl ? 'Manage profile background image' : 'Add profile background image'}
              disabled={coverUploading}
            />
          ) : null}
          <div className="public-profile-hero__chrome pointer-events-none relative z-[2] min-h-[17rem] px-4 pb-32 pt-[calc(var(--app-safe-top)+0.85rem)] sm:min-h-[20rem] sm:px-6">
            <div className="pointer-events-none flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleBack}
                  className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white shadow-[0_10px_24px_rgba(0,0,0,0.24)] backdrop-blur-sm transition hover:bg-black/50"
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
                  className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white shadow-[0_10px_24px_rgba(0,0,0,0.24)] backdrop-blur-sm transition hover:bg-black/50"
                  aria-label="Search profile"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                    <path d="m16 16 4.25 4.25" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white shadow-[0_10px_24px_rgba(0,0,0,0.24)] backdrop-blur-sm transition hover:bg-black/50"
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
          <div className="public-profile-content w-full">
            <div className="pointer-events-none absolute inset-x-0 bottom-0 top-20 bg-white sm:top-24" aria-hidden="true" />
            <div className="relative px-4 pb-5 pt-0 sm:px-6">
              <div className="relative z-[1] flex flex-col gap-4">
                <div className="relative flex items-end justify-between gap-4">
                  <div className="-mt-10 flex min-w-0 flex-1 items-end gap-4 sm:-mt-12">
                    {isSelf ? (
                      <button
                        type="button"
                        onClick={handleAvatarSurfaceTap}
                        className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-[5px] border-white bg-slate-100 text-2xl font-semibold text-slate-700 shadow-[0_12px_24px_rgba(15,23,42,0.18)] transition hover:scale-[1.01] sm:h-32 sm:w-32"
                        aria-label={avatarUrl ? 'Manage profile photo' : 'Add profile photo'}
                        disabled={avatarUploading}
                      >
                        <div className="h-full w-full overflow-hidden rounded-full bg-slate-100">
                          {avatarUrl ? (
                            <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <span>{avatarInitials}</span>
                            </div>
                          )}
                        </div>
                        <span className="absolute bottom-1 right-1 inline-flex items-center justify-center rounded-full border border-white/75 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700 shadow-sm">
                          Edit
                        </span>
                      </button>
                    ) : (
                      <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-[5px] border-white bg-slate-100 text-2xl font-semibold text-slate-700 shadow-[0_12px_24px_rgba(15,23,42,0.18)] sm:h-32 sm:w-32">
                        <div className="h-full w-full overflow-hidden rounded-full bg-slate-100">
                          {avatarUrl ? (
                            <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <span>{avatarInitials}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
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
                    <button type="button" className="inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-50" onClick={() => setProfileEditSheetOpen(true)}>
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

                {isSelf && (avatarUploadError || coverUploadError) ? (
                  <div className="relative rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {avatarUploadError || coverUploadError}
                  </div>
                ) : null}

                <div className="relative flex flex-wrap items-center gap-4 text-[14px] font-medium text-slate-500">
                  <span><span className="font-semibold text-slate-900">{Number(profile?.followingCount || 0)}</span> Following</span>
                  <span><span className="font-semibold text-slate-900">{Number(profile?.followerCount || 0)}</span> Followers</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="public-profile-content public-profile-feed w-full bg-white">
        <section className="public-profile-feed-row border-t border-slate-200 bg-white pt-3">
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

        <section className="public-profile-feed-row bg-white pt-6">
          <div className="flex items-center justify-between gap-4 px-4 sm:px-6">
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
            <div className="mt-5 border-y border-slate-200 bg-white px-4 py-2.5">
                <FeedComposerPill
                  size="compact"
                  avatarUrl={currentViewerAvatarUrl}
                  avatarAlt={currentViewerName}
                  avatarFallback={<span>{extractInitials(currentViewerName)}</span>}
                  message={`What's on your mind, ${currentViewerFirstName}?`}
                  onMessageClick={() => {
                    // Always open modal overlay composer
                    openCreateOwnedPostComposer()
                  }}
                  rightActionIcon="camera"
                  onRightActionClick={openCreateOwnedPostScreenshotPicker}
                  rightActionLabel="Add photo or screenshot"
                  rightActionTitle="Add photo or screenshot"
                />
            </div>
          ) : canFollow ? (
            <div className="mt-5 border-y border-slate-200 bg-white px-4 py-2.5">
              <FeedComposerPill
                size="compact"
                avatarUrl={currentViewerAvatarUrl}
                avatarAlt={currentViewerName}
                avatarFallback={<span>{extractInitials(currentViewerName)}</span>}
                message={`Post a challenge to ${firstName}`}
                onMessageClick={openCreateOwnedPostComposer}
                rightActionIcon="camera"
                onRightActionClick={openCreateOwnedPostScreenshotPicker}
                rightActionLabel="Add photo or screenshot"
                rightActionTitle="Add photo or screenshot"
              />
            </div>
          ) : null}
        </section>

        <section className="public-profile-feed-row bg-white space-y-0 pb-8">
          {profileLoading ? <div className="public-profile-feed-message border-y border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">Loading profile...</div> : null}
          {profileError ? <div className="public-profile-feed-message border-y border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-700">{profileError}</div> : null}

          {!profileLoading && !profileError && activeTab === 'all' ? (
            postsLoading ? <div className="public-profile-feed-message border-y border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">Loading posts...</div> : postsError ? <div className="public-profile-feed-message border-y border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-700">{postsError}</div> : posts.length === 0 ? <div className="public-profile-feed-message border-y border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">No posts yet.</div> : <div className="public-profile-feed-list divide-y divide-black/10 border-y border-black/10 bg-white">{posts.map(renderPostCard)}</div>
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

      <PostComposerOverlay
        open={postComposerOpen}
        editingPostId={editingOwnedPostId}
        viewerName={currentViewerName}
        viewerAvatarUrl={currentViewerAvatarUrl}
        titleDraft={postTitleDraft}
        audienceDraft={postAudienceDraft}
        maxAttempts={postMaxAttemptsDraft}
        parseOnUpload={postParseOnUpload}
        parsedJsonText={postParsedJsonText}
        parsedOpen={postParsedOpen}
        uploading={postReplyImageUploading}
        posting={postPosting}
        imageEditOpen={postReplyImageEditOpen}
        imageEditFile={postReplyImageEditFile}
        contentBlocks={postSolveBlocks}
        draftText={postSolveText}
        editingTarget={postSolveEditingTarget}
        crudTarget={composerBlockCrudTarget}
        typedOverlay={postTypedSolveOverlay}
        canvasOverlay={postSolveOverlay}
        typedLatex={postTypedSolveLatex}
        typedChromeVisible={postTypedOverlayChromeVisible}
        isMobile={isMobile}
        viewerId={currentViewerId}
        gradeLabel={activeGradeLabel}
        roleProfile={currentLessonRoleProfile}
        imageSourceSheetOpen={postReplyImageSourceSheetOpen}
        cameraInputRef={postReplyCameraInputRef}
        galleryInputRef={postReplyGalleryInputRef}
        textareaRef={postSolveTextareaRef}
        onClose={closeOwnedPostComposer}
        onTitleChange={setPostTitleDraft}
        onAudienceChange={setPostAudienceDraft}
        onMaxAttemptsChange={setPostMaxAttemptsDraft}
        onParseOnUploadChange={setPostParseOnUpload}
        onToggleParsedOpen={() => setPostParsedOpen((value) => !value)}
        onDraftTextChange={setPostSolveText}
        onTypedLatexChange={setPostTypedSolveLatex}
        onCloseBlockCrud={() => setComposerBlockCrudTarget(null)}
        onOpenTyped={() => openTypedPostSolveComposer({
          postId: editingOwnedPostId || 'draft-post',
          threadKey: editingOwnedPostId ? `post:${editingOwnedPostId}` : 'post:draft-post',
          title: postTitleDraft || 'Post',
          prompt: String(postSolveText || '').trim(),
          imageUrl: null,
          authorName: currentViewerName,
          authorAvatarUrl: currentViewerAvatarUrl,
          postContentBlocks: composePostSolveBlocksWithDraftText(postSolveBlocks, String(postSolveText || ''), postSolveEditingTarget),
        }, 'keyboard')}
        onOpenHandwritten={() => openHandwrittenPostSolveComposer({
          postId: editingOwnedPostId || 'draft-post',
          threadKey: editingOwnedPostId ? `post:${editingOwnedPostId}` : 'post:draft-post',
          title: postTitleDraft || 'Post',
          prompt: String(postSolveText || '').trim(),
          imageUrl: null,
          authorName: currentViewerName,
          authorAvatarUrl: currentViewerAvatarUrl,
          postContentBlocks: composePostSolveBlocksWithDraftText(postSolveBlocks, String(postSolveText || ''), postSolveEditingTarget),
        })}
        onOpenImagePicker={openPostReplyImagePicker}
        onImagePicked={onPostReplyImagePicked}
        onCloseImageSourceSheet={() => setPostReplyImageSourceSheetOpen(false)}
        onOpenCameraPicker={openPostReplyCameraPicker}
        onOpenGalleryPicker={openPostReplyGalleryPicker}
        onSubmit={() => void submitOwnedPost()}
        onCancelImageEdit={closePostReplyImageEdit}
        onConfirmImageEdit={(file) => void confirmPostReplyImageEdit(file)}
        onCanvasCancel={() => {
          setPostSolveOverlay(null)
          setPostSolveEditingTarget((current) => current?.type === 'canvas' ? null : current)
          setPostSolveError(null)
        }}
        onCanvasSubmit={(scene) => void submitPostSolve(scene)}
        onTypedClose={() => {
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

      <OwnPostsManagerOverlay
        open={ownPostsManagerOpen}
        posts={posts}
        onClose={() => setOwnPostsManagerOpen(false)}
        getPostContentProps={getOwnPostManagerContentProps}
        onEdit={(post) => {
          setOwnPostsManagerOpen(false)
          openEditOwnedPostComposer(post)
        }}
        onDelete={(postId) => deleteOwnedPost(postId)}
      />

      {postCrudTarget ? (
        <OverlayPortal>
          <PostCrudBottomSheet
            open
            onClose={() => setPostCrudTarget(null)}
            onEdit={() => editPostFromCrudTarget(postCrudTarget)}
            onDelete={() => void deletePostFromCrudTarget(postCrudTarget)}
          />
        </OverlayPortal>
      ) : null}

      {replyCrudTarget ? (
        <OverlayPortal>
          <ReplyCrudBottomSheet
            open
            onClose={() => setReplyCrudTarget(null)}
            onEdit={() => editReplyFromCrudTarget(replyCrudTarget)}
            onDelete={() => void deleteReplyFromCrudTarget(replyCrudTarget)}
          />
        </OverlayPortal>
      ) : null}

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
                  const overlayPost = posts.find((post) => String(post?.id || '') === String(postThreadOverlay.postId || '')) || null
                  const containerProps = overlayPost
                    ? getPostReplyContainerProps(overlayPost, response, responseUserId === currentViewerId)
                    : undefined

                  return (
                    <div key={String(response?.id || Math.random())} className="rounded-2xl border border-white/10 bg-white/5 p-4" {...containerProps}>
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
        <OverlayPortal>
          <ZoomableImageOverlay
            open={Boolean(imageViewer)}
            imageUrl={imageViewer.url}
            title={imageViewer.title}
            onClose={closeImageViewer}
          />
        </OverlayPortal>
      ) : null}

      {isSelf && profileEditSheetOpen ? (
        <OverlayPortal>
          <BottomSheet
            open
            backdrop
            title="Edit profile"
            subtitle="Choose what you want to update"
            onClose={() => setProfileEditSheetOpen(false)}
            zIndexClassName="z-[68]"
            className="bottom-0"
            sheetClassName="rounded-t-[28px] rounded-b-none border-x-0 border-b-0 border-t border-slate-200 bg-white shadow-[0_-18px_40px_rgba(15,23,42,0.14)]"
            contentClassName="px-4 pb-[calc(var(--app-safe-bottom)+1rem)] pt-2 sm:px-5 sm:pb-5"
          >
            <div className="space-y-2">
              <button type="button" className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-slate-800 transition hover:border-slate-300 hover:bg-slate-100" onClick={handleAvatarSurfaceTap}>
                <span>
                  <span className="block text-sm font-semibold">{avatarUrl ? 'Change profile photo' : 'Add profile photo'}</span>
                  <span className="block text-xs text-slate-500">Upload, replace, or manage your avatar.</span>
                </span>
                <span className="text-slate-400">{'>'}</span>
              </button>
              <button type="button" className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-slate-800 transition hover:border-slate-300 hover:bg-slate-100" onClick={handleCoverSurfaceTap}>
                <span>
                  <span className="block text-sm font-semibold">{editableCoverUrl ? 'Change background image' : 'Add background image'}</span>
                  <span className="block text-xs text-slate-500">Set the large profile hero image.</span>
                </span>
                <span className="text-slate-400">{'>'}</span>
              </button>
              <button type="button" className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-slate-800 transition hover:border-slate-300 hover:bg-slate-100" onClick={openProfileDetailsEditor}>
                <span>
                  <span className="block text-sm font-semibold">Edit details</span>
                  <span className="block text-xs text-slate-500">Update your info, settings, and visibility.</span>
                </span>
                <span className="text-slate-400">{'>'}</span>
              </button>
            </div>
          </BottomSheet>
        </OverlayPortal>
      ) : null}

      {isSelf && profileMediaSheetTarget ? (
        <OverlayPortal>
          <BottomSheet
            open
            backdrop
            title={profileMediaSheetTarget === 'avatar' ? 'Profile photo' : 'Profile background'}
            subtitle={profileMediaSheetTarget === 'avatar' ? 'Manage your avatar' : 'Manage your background image'}
            onClose={() => setProfileMediaSheetTarget(null)}
            zIndexClassName="z-[69]"
            className="bottom-0"
            sheetClassName="rounded-t-[28px] rounded-b-none border-x-0 border-b-0 border-t border-slate-200 bg-white shadow-[0_-18px_40px_rgba(15,23,42,0.14)]"
            contentClassName="px-4 pb-[calc(var(--app-safe-bottom)+1rem)] pt-2 sm:px-5 sm:pb-5"
          >
            <div className="space-y-2">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-slate-800 transition hover:border-slate-300 hover:bg-slate-100"
                onClick={() => {
                  if (profileMediaSheetTarget === 'avatar' && avatarUrl) {
                    openImageViewer(avatarUrl, `${displayName} profile photo`)
                  }
                  if (profileMediaSheetTarget === 'cover' && editableCoverUrl) {
                    openImageViewer(editableCoverUrl, `${displayName} background image`)
                  }
                  setProfileMediaSheetTarget(null)
                }}
              >
                <span>
                  <span className="block text-sm font-semibold">View image</span>
                  <span className="block text-xs text-slate-500">Open the current image in the viewer.</span>
                </span>
                <span className="text-slate-400">{'>'}</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left text-slate-800 transition hover:border-slate-300 hover:bg-slate-100"
                onClick={profileMediaSheetTarget === 'avatar' ? openAvatarPicker : openCoverPicker}
              >
                <span>
                  <span className="block text-sm font-semibold">Replace image</span>
                  <span className="block text-xs text-slate-500">Choose a new {profileMediaSheetTarget === 'avatar' ? 'profile photo' : 'background image'}.</span>
                </span>
                <span className="text-slate-400">{'>'}</span>
              </button>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-left text-red-700 transition hover:border-red-300 hover:bg-red-100"
                onClick={() => {
                  if (profileMediaSheetTarget === 'avatar') {
                    void removeAvatar()
                    return
                  }
                  void removeCover()
                }}
                disabled={profileMediaSheetTarget === 'avatar' ? avatarUploading : coverUploading}
              >
                <span>
                  <span className="block text-sm font-semibold">Remove image</span>
                  <span className="block text-xs text-red-500">Clear the current {profileMediaSheetTarget === 'avatar' ? 'profile photo' : 'background image'}.</span>
                </span>
                <span className="text-red-300">{'>'}</span>
              </button>
            </div>
          </BottomSheet>
        </OverlayPortal>
      ) : null}

      {isSelf && accountControlOpen ? (
        <OverlayPortal>
          <AccountControlOverlay onRequestClose={closeAccountControl} />
        </OverlayPortal>
      ) : null}

      {isSelf ? (
        <>
          <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onAvatarFileChange} />
          <input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onCoverFileChange} />
          <OverlayPortal>
            <ImageCropperModal
              open={Boolean(avatarCropFile)}
              file={avatarCropFile}
              title="Crop profile photo"
              aspectRatio={1}
              circularCrop
              onCancel={() => setAvatarCropFile(null)}
              onUseOriginal={confirmAvatarCrop}
              onConfirm={confirmAvatarCrop}
              confirmLabel="Set as avatar"
            />
          </OverlayPortal>
          <OverlayPortal>
            <ImageCropperModal
              open={Boolean(coverCropFile)}
              file={coverCropFile}
              title="Crop background image"
              aspectRatio={16 / 9}
              onCancel={() => setCoverCropFile(null)}
              onUseOriginal={confirmCoverCrop}
              onConfirm={confirmCoverCrop}
              confirmLabel="Set as background"
            />
          </OverlayPortal>
        </>
      ) : null}
    </main>
  )
}

export default function PublicUserProfilePage() {
  return <PublicUserProfileSurface />
}

export const getServerSideProps: GetServerSideProps = async () => {
  return { props: {} }
}
