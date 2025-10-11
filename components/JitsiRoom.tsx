import React, { useEffect, useRef, useState } from 'react'

type Props = {
  roomName: string
  displayName?: string
  sessionId?: string | number | null
  isOwner?: boolean
  // Optional JaaS JWT token (if using Jitsi as a Service)
  jaasJwt?: string | null
}

export default function JitsiRoom({ roomName, displayName, sessionId, isOwner, jaasJwt }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<any>(null)
  const [loaded, setLoaded] = useState(false)
  const [audioMuted, setAudioMuted] = useState(false)
  const [videoMuted, setVideoMuted] = useState(false)
  const [whiteboardOpen, setWhiteboardOpen] = useState(false)

  useEffect(() => {
    // Load Jitsi script if not present. The script URL may come from NEXT_PUBLIC_JITSI_API_URL
    const loadScript = () => {
      return new Promise<void>((resolve, reject) => {
        if ((window as any).JitsiMeetExternalAPI) return resolve()
        const script = document.createElement('script')
        // Allow overriding the domain and script URL via env vars so we can switch to JaaS or self-hosted
        const publicApiUrl = (process.env.NEXT_PUBLIC_JITSI_API_URL as string) || ''
        script.src = publicApiUrl || 'https://meet.jit.si/external_api.js'
        script.async = true
        script.onload = () => resolve()
        script.onerror = () => reject(new Error('Failed to load Jitsi script'))
        document.body.appendChild(script)
      })
    }

    let mounted = true
    loadScript().then(() => {
      if (!mounted) return
  // Domain may be overridden by NEXT_PUBLIC_JITSI_DOMAIN (e.g. your.jitsi.domain or jaas.host)
  const domain = (process.env.NEXT_PUBLIC_JITSI_DOMAIN as string) || 'meet.jit.si'
  // Allow supplying a JaaS JWT either via prop or a global set on window
  const jaasJwtToken = jaasJwt || (window as any).__JITSI_JAAS_JWT__ || null
      // If using the public meet.jit.si demo server, don't embed it inside an iframe
      // because the public instance shows a 5-minute demo warning and will disconnect.
      // Instead, show a notice in the UI and let the user open the room in a new tab.
      // If using the public meet.jit.si demo server, prefer opening in a new tab instead
      // because the public server shows a demo warning and may disconnect. For JaaS
      // or self-hosted domains we proceed to embed.
      if (domain === 'meet.jit.si') {
        ;(window as any).__JITSI_EMBED_SKIPPED__ = true
        setLoaded(false)
        return
      }
      const isOwnerFlag = Boolean(isOwner) || Boolean((window as any).__JITSI_IS_OWNER__)
      // Toolbar choices depend on whether this client is the owner. Non-owners are not given camera/screen controls.
      const toolbarButtons = isOwnerFlag
        ? ['microphone', 'camera', 'desktop', 'chat', 'raisehand', 'hangup', 'tileview']
        : ['microphone', 'chat', 'raisehand', 'hangup', 'tileview']

      const options: any = {
        roomName,
        parentNode: containerRef.current,
        interfaceConfigOverwrite: { TOOLBAR_BUTTONS: toolbarButtons },
        // If this client is the owner, disable the prejoin page so they auto-join immediately
        configOverwrite: { disableDeepLinking: true, prejoinPageEnabled: !isOwnerFlag },
        userInfo: { displayName: displayName || 'Learner' }
      }

      // If we have a JaaS token, pass it via the jwt option so the JaaS service validates the request
      if (jaasJwtToken) {
        options.jwt = jaasJwtToken
      }
      try {
        ;(window as any).__JITSI_EMBED_SKIPPED__ = false
        apiRef.current = new (window as any).JitsiMeetExternalAPI(domain, options)
        setLoaded(true)
        // Listen for audio/video mute changes
        apiRef.current.addEventListener('audioMuteStatusChanged', (e: any) => setAudioMuted(e.muted))
        apiRef.current.addEventListener('videoMuteStatusChanged', (e: any) => setVideoMuted(e.muted))

        // Apply password only after the owner has fully joined (videoConferenceJoined)
        apiRef.current.addEventListener('videoConferenceJoined', async () => {
          try {
            // Only attempt to set password when this client is the owner (set below from dashboard)
            const isOwner = Boolean((window as any).__JITSI_IS_OWNER__)
            if (!isOwner) return
            if (!sessionId) return
            const res = await fetch(`/api/sessions/${sessionId}/password`, { credentials: 'same-origin' })
            if (!res.ok) return
            const data = await res.json().catch(() => null)
            const pw = data?.jitsiPassword
            if (pw && apiRef.current && typeof apiRef.current.executeCommand === 'function') {
              try {
                apiRef.current.executeCommand('password', pw)
              } catch (err) {
                try { apiRef.current.executeCommand('setPassword', pw) } catch (e) {}
              }
            }
            // Notify server that owner is present so learners may join
            try {
              await fetch(`/api/sessions/${sessionId}/present`, { method: 'POST', credentials: 'same-origin' })
            } catch (e) {
              // ignore
            }
          } catch (err) {
            // ignore
          }
        })
        
      } catch (err) {
        console.error('Failed to create Jitsi API', err)
      }
    }).catch(err => console.error(err))

    return () => {
      mounted = false
      try { (window as any).__JITSI_EMBED_SKIPPED__ = false } catch (e) {}
      try { apiRef.current?.dispose() } catch (e) {}
    }
  }, [roomName])

  const toggleAudio = () => {
    if (!apiRef.current) return
    apiRef.current.executeCommand('toggleAudio')
  }

  const toggleVideo = () => {
    // Only owners may start/broadcast video
    const isOwnerFlag = Boolean((window as any).__JITSI_IS_OWNER__) || false
    if (!isOwnerFlag) return
    if (!apiRef.current) return
    apiRef.current.executeCommand('toggleVideo')
  }

  const hangup = () => {
    if (!apiRef.current) return
    apiRef.current.executeCommand('hangup')
  }

  const openWhiteboard = () => {
    setWhiteboardOpen(true)
  }

  const closeWhiteboard = () => {
    setWhiteboardOpen(false)
  }

  return (
    <div className="jitsi-room">
  {/* If we're deliberately not embedding the public meet.jit.si, show a notice */}
  {(!loaded && (window as any).__JITSI_EMBED_SKIPPED__ === true) && (
        <div className="mb-4 border rounded p-3 bg-yellow-50">
          <div className="font-medium">Live class (external)</div>
          <div className="mt-2 text-sm">
            The application is configured to use the public meet.jit.si demo server. Embedding
            the public server shows a demo warning and will disconnect after a few minutes.
            To join the class without that limitation, open the meeting in a new tab.
          </div>
          <div className="mt-3 flex gap-2">
            <a
              className="btn btn-primary"
              href={`https://meet.jit.si/${encodeURIComponent(roomName)}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open in new tab
            </a>
            <button
              className="btn"
              onClick={() => setLoaded(true)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <div className="mb-2 flex gap-2">
        <button className="btn" onClick={toggleAudio}>{audioMuted ? 'Unmute' : 'Mute'}</button>
        {/* Only show video control to owners */}
        { (Boolean(isOwner) || Boolean((window as any).__JITSI_IS_OWNER__)) && (
          <button className="btn" onClick={toggleVideo}>{videoMuted ? 'Start video' : 'Stop video'}</button>
        )}
        <button className="btn" onClick={openWhiteboard}>Open whiteboard</button>
        <button className="btn btn-danger" onClick={hangup}>Leave</button>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '600px' }} />

      {whiteboardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="bg-white rounded shadow-lg w-[90%] h-[80%] relative">
            <div className="p-2 flex justify-between items-center border-b">
              <div className="font-medium">Whiteboard</div>
              <button className="btn btn-sm" onClick={closeWhiteboard}>Close</button>
            </div>
            <iframe src="https://excalidraw.com/" title="Whiteboard" style={{ width: '100%', height: 'calc(100% - 48px)', border: 'none' }} />
          </div>
        </div>
      )}
    </div>
  )
}
