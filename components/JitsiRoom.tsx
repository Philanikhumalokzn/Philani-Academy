import React, { useCallback, useEffect, useRef, useState } from 'react'

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
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<any>(null)
  const [audioMuted, setAudioMuted] = useState(false)
  const [videoMuted, setVideoMuted] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [lobbyEnabled, setLobbyEnabled] = useState<boolean | null>(true)
  const [lobbyError, setLobbyError] = useState<string | null>(null)
  const [lobbyBusy, setLobbyBusy] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(false)
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
              if (tkRes.status === 403) {
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

        const options: any = {
          roomName,
          parentNode: containerRef.current,
          interfaceConfigOverwrite: { TOOLBAR_BUTTONS: ['microphone', 'camera', 'hangup', 'tileview'] },
          configOverwrite: { disableDeepLinking: true, lobbyEnabled: true },
          userInfo: { displayName: displayName || 'Learner' }
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

        // attach listeners safely
        try {
          apiRef.current.addEventListener('audioMuteStatusChanged', (e: any) => setAudioMuted(e.muted))
          apiRef.current.addEventListener('videoMuteStatusChanged', (e: any) => setVideoMuted(e.muted))
        } catch (err) {
          // ignore
        }

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
      try { apiRef.current?.dispose() } catch (e) {}
      if (apiRef.current && (apiRef.current as any)._lobbyToggleListener) {
        try { apiRef.current.removeEventListener('lobby.toggle', (apiRef.current as any)._lobbyToggleListener) } catch (e) {}
        delete (apiRef.current as any)._lobbyToggleListener
      }
    }
  }, [initialRoomName, sessionId, displayName, tokenEndpoint, passwordEndpoint, isOwner])

  const toggleAudio = () => { if (!apiRef.current) return; apiRef.current.executeCommand('toggleAudio') }
  const toggleVideo = () => { if (!apiRef.current) return; apiRef.current.executeCommand('toggleVideo') }
  const hangup = () => { if (!apiRef.current) return; apiRef.current.executeCommand('hangup') }
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

  const clearControlsHideTimer = useCallback(() => {
    if (controlsHideTimerRef.current) {
      clearTimeout(controlsHideTimerRef.current)
      controlsHideTimerRef.current = null
    }
  }, [])

  const scheduleControlsHide = useCallback((delay = 4000) => {
    clearControlsHideTimer()
    controlsHideTimerRef.current = setTimeout(() => {
      setControlsVisible(false)
    }, delay)
  }, [clearControlsHideTimer])

  const handleSurfaceTap = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!showControls) return
    const target = event.target as HTMLElement | null
    if (target?.dataset?.inlineControl === 'true') {
      return
    }
    setControlsVisible(prev => {
      const next = !prev
      if (next) {
        scheduleControlsHide()
      } else {
        clearControlsHideTimer()
      }
      return next
    })
  }, [showControls, scheduleControlsHide, clearControlsHideTimer])

  const handleControlButton = useCallback(
    (action: () => void | Promise<void>) => async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      await action()
      scheduleControlsHide(1800)
    },
    [scheduleControlsHide]
  )

  useEffect(() => {
    return () => {
      clearControlsHideTimer()
    }
  }, [clearControlsHideTimer])

  return (
    <div className={wrapperClass}>
      {initError && <div className="mb-2 text-sm text-red-600">{initError}</div>}
      {lobbyError && <div className="mb-2 text-sm text-red-600">{lobbyError}</div>}
      <div
        className="relative"
        onPointerDownCapture={showControls ? handleSurfaceTap : undefined}
      >
        <div ref={containerRef} style={{ width: '100%', height: resolvedHeight }} />
        {showControls && (
          <div className={`absolute inset-0 transition-opacity duration-200 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent pointer-events-none" />
            <div className="absolute bottom-4 left-0 right-0 flex justify-center">
              <div className="flex flex-wrap gap-2 rounded-full bg-slate-950/80 px-4 py-2 backdrop-blur-lg pointer-events-auto text-sm">
                <button className="btn btn-secondary text-xs" onClick={handleControlButton(toggleAudio)} data-inline-control="true">
                  {audioMuted ? 'Unmute' : 'Mute'}
                </button>
                <button className="btn btn-secondary text-xs" onClick={handleControlButton(toggleVideo)} data-inline-control="true">
                  {videoMuted ? 'Video On' : 'Video Off'}
                </button>
                <button className="btn btn-danger text-xs" onClick={handleControlButton(hangup)} data-inline-control="true">
                  Leave
                </button>
                {isOwner && (
                  <button
                    className="btn btn-secondary text-xs"
                    onClick={handleControlButton(toggleLobby)}
                    disabled={lobbyBusy}
                    data-inline-control="true"
                  >
                    {lobbyEnabled ? 'Close Lobby' : 'Open Lobby'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
