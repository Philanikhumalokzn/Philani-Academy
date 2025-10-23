import React, { useEffect, useRef, useState } from 'react'

type Props = {
  roomName: string
  displayName?: string
  sessionId?: string | number | null
  isOwner?: boolean
}

export default function JitsiRoom({ roomName: initialRoomName, displayName, sessionId }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<any>(null)
  const [audioMuted, setAudioMuted] = useState(false)
  const [videoMuted, setVideoMuted] = useState(false)

  useEffect(() => {
    let mounted = true

    const loadScript = (url?: string) => {
      return new Promise<void>((resolve, reject) => {
        if ((window as any).JitsiMeetExternalAPI) return resolve()
        const script = document.createElement('script')
        script.src = url || (process.env.NEXT_PUBLIC_JITSI_API_URL as string) || 'https://meet.jit.si/external_api.js'
        script.async = true
        script.onload = () => resolve()
        script.onerror = () => reject(new Error('Failed to load Jitsi script'))
        document.body.appendChild(script)
      })
    }

    const init = async () => {
      try {
        const domain = (process.env.NEXT_PUBLIC_JITSI_DOMAIN as string) || 'meet.jit.si'
        const apiUrl = (process.env.NEXT_PUBLIC_JITSI_API_URL as string) || 'https://meet.jit.si/external_api.js'

        await loadScript(apiUrl)
        if (!mounted) return

        let roomName = initialRoomName
        let jwtToken: string | undefined

        if (sessionId) {
          try {
            const tkRes = await fetch(`/api/sessions/${sessionId}/token`, { credentials: 'same-origin', cache: 'no-store' })
            if (tkRes.ok) {
              const tkJson = await tkRes.json().catch(() => null)
              jwtToken = tkJson?.token
              if (tkJson?.roomName) roomName = tkJson.roomName
            }
          } catch (err) {
            // token fetch failed; continue without JWT
            console.warn('Jitsi token fetch failed:', err)
          }
        }

        const options: any = {
          roomName,
          parentNode: containerRef.current,
          interfaceConfigOverwrite: { TOOLBAR_BUTTONS: ['microphone', 'camera', 'hangup', 'tileview'] },
          configOverwrite: { disableDeepLinking: true },
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

        // attempt to apply a room password provided by the server
        const applyPassword = async () => {
          try {
            if (!sessionId) return
            const res = await fetch(`/api/sessions/${sessionId}/password`, { credentials: 'same-origin', cache: 'no-store' })
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
      }
    }

    init()

    return () => {
      mounted = false
      try { apiRef.current?.dispose() } catch (e) {}
    }
  }, [initialRoomName, sessionId, displayName])

  const toggleAudio = () => { if (!apiRef.current) return; apiRef.current.executeCommand('toggleAudio') }
  const toggleVideo = () => { if (!apiRef.current) return; apiRef.current.executeCommand('toggleVideo') }
  const hangup = () => { if (!apiRef.current) return; apiRef.current.executeCommand('hangup') }

  return (
    <div className="jitsi-room">
      <div className="mb-2 flex gap-2">
        <button className="btn" onClick={toggleAudio}>{audioMuted ? 'Unmute' : 'Mute'}</button>
        <button className="btn" onClick={toggleVideo}>{videoMuted ? 'Start video' : 'Stop video'}</button>
        <button className="btn btn-danger" onClick={hangup}>Leave</button>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: 600 }} />
    </div>
  )
}
