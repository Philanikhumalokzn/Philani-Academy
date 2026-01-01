import React, { useCallback, useEffect, useRef, useState } from 'react'

export type JitsiParticipantInfo = {
  id: string
  displayName?: string
  formattedDisplayName?: string
  email?: string
  role?: string
  isLocal?: boolean
}

export type JitsiControls = {
  toggleAudio: () => void
  toggleVideo: () => void
  hangup: () => void
  setParticipantVolume?: (participantId: string, volume: number) => void
  getParticipantsInfo?: () => JitsiParticipantInfo[]
}

export type JitsiMuteState = {
  audioMuted: boolean
  videoMuted: boolean
}

type Props = {
  roomName: string
  displayName?: string
  sessionId?: string | number | null
  isOwner?: boolean
  tokenEndpoint?: string | null
  passwordEndpoint?: string | null
  height?: number | string
  className?: string
  showControls?: boolean
  silentJoin?: boolean
  onControlsChange?: (controls: JitsiControls | null) => void
  onMuteStateChange?: (state: JitsiMuteState) => void
  onParticipantsChange?: (participants: JitsiParticipantInfo[]) => void
  toolbarButtons?: string[]
  startWithAudioMuted?: boolean
  startWithVideoMuted?: boolean
}

export default function JitsiRoom({
  roomName: initialRoomName,
  displayName,
  sessionId,
  tokenEndpoint,
  passwordEndpoint,
  isOwner,
  height,
  className,
  showControls = true,
  silentJoin = false,
  onControlsChange,
  onMuteStateChange,
  onParticipantsChange,
  toolbarButtons,
  startWithAudioMuted,
  startWithVideoMuted,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<any>(null)
  const [audioMuted, setAudioMuted] = useState(Boolean(startWithAudioMuted))
  const [videoMuted, setVideoMuted] = useState(Boolean(startWithVideoMuted))
  const audioMutedRef = useRef(Boolean(startWithAudioMuted))
  const videoMutedRef = useRef(Boolean(startWithVideoMuted))
  const [initError, setInitError] = useState<string | null>(null)
  const [lobbyEnabled, setLobbyEnabled] = useState<boolean | null>(true)
  const [lobbyError, setLobbyError] = useState<string | null>(null)
  const [lobbyBusy, setLobbyBusy] = useState(false)
  const participantsRef = useRef<JitsiParticipantInfo[]>([])

  useEffect(() => {
    audioMutedRef.current = audioMuted
  }, [audioMuted])

  useEffect(() => {
    videoMutedRef.current = videoMuted
  }, [videoMuted])

  const toggleAudio = useCallback(() => {
    if (!apiRef.current) return
    apiRef.current.executeCommand('toggleAudio')
  }, [])

  const toggleVideo = useCallback(() => {
    if (!apiRef.current) return
    apiRef.current.executeCommand('toggleVideo')
  }, [])

  const hangup = useCallback(() => {
    if (!apiRef.current) return
    apiRef.current.executeCommand('hangup')
  }, [])

  const setParticipantVolume = useCallback((participantId: string, volume: number) => {
    if (!apiRef.current) return
    if (!participantId) return
    const clamped = Math.min(Math.max(volume, 0), 1)
    try {
      apiRef.current.setParticipantVolume?.(participantId, clamped)
    } catch {}
  }, [])

  const syncParticipants = useCallback(() => {
    if (!apiRef.current || typeof apiRef.current.getParticipantsInfo !== 'function') return
    try {
      const raw = apiRef.current.getParticipantsInfo() || []
      const localId = typeof apiRef.current.getCurrentUserID === 'function' ? apiRef.current.getCurrentUserID() : null
      const normalized: JitsiParticipantInfo[] = raw
        .map((p: any) => ({
          id: p?.participantId || p?.id || '',
          displayName: p?.displayName,
          formattedDisplayName: p?.formattedDisplayName,
          email: p?.email,
          role: p?.role,
          isLocal: Boolean(localId && (p?.participantId === localId || p?.id === localId)),
        }))
        .filter((p: JitsiParticipantInfo) => Boolean(p.id))

      participantsRef.current = normalized
      onParticipantsChange?.(normalized)
    } catch {
      // ignore participant sync errors
    }
  }, [onParticipantsChange])

  useEffect(() => {
    let mounted = true
    setInitError(null)
  setLobbyError(null)
  setLobbyEnabled(true)

    const loadScript = (url?: string) => {
      return new Promise<void>((resolve, reject) => {
        if ((window as any).JitsiMeetExternalAPI) return resolve()
        const script = document.createElement('script')
        // For JaaS, prefer the 8x8 hosted library to ensure correct domain
        const defaultApi = 'https://8x8.vc/libs/external_api.min.js'
        script.src = url || (process.env.NEXT_PUBLIC_JITSI_API_URL as string) || defaultApi
        script.async = true
        script.onload = () => resolve()
        script.onerror = () => reject(new Error('Failed to load Jitsi script'))
        document.body.appendChild(script)
      })
    }

    const init = async () => {
      try {
  const domain = (process.env.NEXT_PUBLIC_JITSI_DOMAIN as string) || '8x8.vc'
  const apiUrl = (process.env.NEXT_PUBLIC_JITSI_API_URL as string) || 'https://8x8.vc/libs/external_api.min.js'

        await loadScript(apiUrl)
        if (!mounted) return

  let roomName = initialRoomName
        let jwtToken: string | undefined

        const tokenUrl = tokenEndpoint ?? (sessionId != null ? `/api/sessions/${sessionId}/token` : null)

        if (tokenUrl) {
          try {
            const tkRes = await fetch(tokenUrl, { credentials: 'same-origin', cache: 'no-store' })
            if (tkRes.ok) {
              const tkJson = await tkRes.json().catch(() => null)
              jwtToken = tkJson?.token
              if (tkJson?.roomName) roomName = tkJson.roomName
            } else {
              const body = await tkRes.json().catch(() => null)
              const serverMessage = typeof body?.message === 'string' ? body.message.trim() : ''
              if (serverMessage) {
                setInitError(serverMessage)
              } else if (tkRes.status === 403) {
                setInitError('You do not have access to this meeting.')
              } else {
                setInitError(`Failed to fetch meeting token (${tkRes.status}).`)
              }
              return
            }
          } catch (err) {
            // token fetch failed; continue without JWT
            console.warn('Jitsi token fetch failed:', err)
            setInitError('Unable to fetch meeting token. Please try again.')
            return
          }
        }

        const resolvedToolbarButtons = Array.isArray(toolbarButtons)
          ? toolbarButtons
          : ['microphone', 'camera', 'hangup', 'tileview']

        const options: any = {
          roomName,
          parentNode: containerRef.current,
          interfaceConfigOverwrite: { TOOLBAR_BUTTONS: resolvedToolbarButtons },
          configOverwrite: {
            disableDeepLinking: true,
            lobbyEnabled: true,
            // Silent/background join: skip the pre-join UI so the iframe immediately joins.
            // Jitsi config keys have changed over time; set both the legacy and newer knobs.
            prejoinPageEnabled: silentJoin ? false : undefined,
            prejoinConfig: silentJoin ? { enabled: false } : undefined,
            enableWelcomePage: silentJoin ? false : undefined,
            startWithAudioMuted: Boolean(startWithAudioMuted),
            startWithVideoMuted: Boolean(startWithVideoMuted),
          },
          userInfo: { displayName: displayName || 'Learner' },
        }

        if (jwtToken) options.jwt = jwtToken

        // DEV: log token/room used to initialize Jitsi so we can verify usage
        if (process.env.NODE_ENV !== 'production') {
          try {
            // don't print full token in logs if concerned; printing short fingerprint
            const short = jwtToken ? jwtToken.split('.').slice(0,2).join('.') + '...' : 'no-token'
            console.log('[DEV] initializing Jitsi with token:', short, 'room:', roomName)
          } catch (e) { /* ignore */ }
        }

        apiRef.current = new (window as any).JitsiMeetExternalAPI(domain, options)
        onControlsChange?.({
          toggleAudio,
          toggleVideo,
          hangup,
          setParticipantVolume,
          getParticipantsInfo: () => participantsRef.current,
        })

        // Initial best-effort sync (Jitsi will emit events as it settles).
        try {
          const initialAudio = Boolean(startWithAudioMuted)
          const initialVideo = Boolean(startWithVideoMuted)
          audioMutedRef.current = initialAudio
          videoMutedRef.current = initialVideo
          setAudioMuted(initialAudio)
          setVideoMuted(initialVideo)
          onMuteStateChange?.({ audioMuted: initialAudio, videoMuted: initialVideo })
        } catch {}

        // attach listeners safely
        try {
          apiRef.current.addEventListener('audioMuteStatusChanged', (e: any) => {
            const next = Boolean(e?.muted)
            audioMutedRef.current = next
            setAudioMuted(next)
            try {
              onMuteStateChange?.({ audioMuted: next, videoMuted: videoMutedRef.current })
            } catch {}
          })
          apiRef.current.addEventListener('videoMuteStatusChanged', (e: any) => {
            const next = Boolean(e?.muted)
            videoMutedRef.current = next
            setVideoMuted(next)
            try {
              onMuteStateChange?.({ audioMuted: audioMutedRef.current, videoMuted: next })
            } catch {}
          })
          apiRef.current.addEventListener('participantJoined', () => syncParticipants())
          apiRef.current.addEventListener('participantLeft', () => syncParticipants())
          apiRef.current.addEventListener('participantRoleChanged', () => syncParticipants())
          apiRef.current.addEventListener('participantUpdated', () => syncParticipants())
        } catch (err) {
          // ignore
        }

        syncParticipants()

        if (isOwner && apiRef.current) {
          try {
            const listener = (event: any) => {
              if (!event) return
              if (typeof event.enabled === 'boolean') setLobbyEnabled(event.enabled)
            }
            apiRef.current.addEventListener('lobby.toggle', listener)
            ;(apiRef.current as any)._lobbyToggleListener = listener
          } catch (err) {
            // ignore listener errors
          }
          try {
            if (typeof apiRef.current.isLobbyEnabled === 'function') {
              apiRef.current.isLobbyEnabled().then((value: any) => {
                if (typeof value === 'boolean') setLobbyEnabled(value)
              }).catch(() => {})
            }
          } catch (err) {
            // ignore capability probe
          }
        }

        // attempt to apply a room password provided by the server
        const applyPassword = async () => {
          try {
            const passwordUrl = passwordEndpoint ?? (sessionId != null ? `/api/sessions/${sessionId}/password` : null)
            if (!passwordUrl) return
            const res = await fetch(passwordUrl, { credentials: 'same-origin', cache: 'no-store' })
            if (!res.ok) return
            const data = await res.json().catch(() => null)
            const pw = data?.jitsiPassword
            if (pw && apiRef.current && typeof apiRef.current.executeCommand === 'function') {
              try { apiRef.current.executeCommand('password', pw) } catch (e) {
                try { apiRef.current.executeCommand('setPassword', pw) } catch (err) {}
              }
            }
          } catch (err) {
            // ignore
          }
        }

        setTimeout(() => { applyPassword() }, 800)
      } catch (err) {
        console.error('Failed to initialize Jitsi', err)
        setInitError('Failed to initialize the meeting embed.')
      }
    }

    init()

    return () => {
      mounted = false
      onControlsChange?.(null)
      try { apiRef.current?.dispose() } catch (e) {}
      if (apiRef.current && (apiRef.current as any)._lobbyToggleListener) {
        try { apiRef.current.removeEventListener('lobby.toggle', (apiRef.current as any)._lobbyToggleListener) } catch (e) {}
        delete (apiRef.current as any)._lobbyToggleListener
      }
    }
  }, [initialRoomName, sessionId, displayName, tokenEndpoint, passwordEndpoint, isOwner, onControlsChange, onMuteStateChange, startWithAudioMuted, startWithVideoMuted, toggleAudio, toggleVideo, hangup, toolbarButtons])

  const toggleLobby = async () => {
    if (!apiRef.current) return
    setLobbyError(null)
    setLobbyBusy(true)
    try {
      const next = !(lobbyEnabled === true)
      const result = apiRef.current.executeCommand('toggleLobby', next)
      if (result && typeof result.then === 'function') {
        await result
      }
      setLobbyEnabled(next)
    } catch (err: any) {
      setLobbyError(err?.message || 'Failed to toggle lobby')
    } finally {
      setLobbyBusy(false)
    }
  }

  const resolvedHeight = typeof height === 'number' ? `${height}px` : height || '600px'
  const wrapperClass = className ? `jitsi-room ${className}` : 'jitsi-room'

  return (
    <div className={wrapperClass}>
      {initError && <div className="mb-2 text-sm text-red-600">{initError}</div>}
      {lobbyError && <div className="mb-2 text-sm text-red-600">{lobbyError}</div>}
      {showControls && (
        <div className="mb-2 flex gap-2">
          <button className="btn" onClick={toggleAudio}>{audioMuted ? 'Unmute' : 'Mute'}</button>
          <button className="btn" onClick={toggleVideo}>{videoMuted ? 'Start video' : 'Stop video'}</button>
          <button className="btn btn-danger" onClick={hangup}>Leave</button>
          {isOwner && (
            <button
              className="btn"
              onClick={toggleLobby}
              disabled={lobbyBusy}
            >
              {lobbyEnabled ? 'Disable lobby' : 'Enable lobby'}
            </button>
          )}
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: resolvedHeight }} />
    </div>
  )
}
