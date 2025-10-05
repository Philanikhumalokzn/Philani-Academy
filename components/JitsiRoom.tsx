import React, { useEffect, useRef, useState } from 'react'

type Props = {
  roomName: string
  displayName?: string
  sessionId?: string | number | null
  isOwner?: boolean
}

export default function JitsiRoom({ roomName, displayName, sessionId }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<any>(null)
  const [loaded, setLoaded] = useState(false)
  const [audioMuted, setAudioMuted] = useState(false)
  const [videoMuted, setVideoMuted] = useState(false)

  useEffect(() => {
    // Load Jitsi script if not present
    const loadScript = () => {
      return new Promise<void>((resolve, reject) => {
        if ((window as any).JitsiMeetExternalAPI) return resolve()
        const script = document.createElement('script')
        script.src = 'https://meet.jit.si/external_api.js'
        script.async = true
        script.onload = () => resolve()
        script.onerror = () => reject(new Error('Failed to load Jitsi script'))
        document.body.appendChild(script)
      })
    }

    let mounted = true
    loadScript().then(() => {
      if (!mounted) return
      const domain = 'meet.jit.si'
      const options: any = {
        roomName,
        parentNode: containerRef.current,
        interfaceConfigOverwrite: { TOOLBAR_BUTTONS: ['microphone', 'camera', 'hangup', 'tileview'] },
        // If this client is the owner, disable the prejoin page so they auto-join immediately
        configOverwrite: { disableDeepLinking: true, prejoinPageEnabled: !(Boolean((window as any).__JITSI_IS_OWNER__)), },
        userInfo: { displayName: displayName || 'Learner' }
      }
      try {
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
      try { apiRef.current?.dispose() } catch (e) {}
    }
  }, [roomName])

  const toggleAudio = () => {
    if (!apiRef.current) return
    apiRef.current.executeCommand('toggleAudio')
  }

  const toggleVideo = () => {
    if (!apiRef.current) return
    apiRef.current.executeCommand('toggleVideo')
  }

  const hangup = () => {
    if (!apiRef.current) return
    apiRef.current.executeCommand('hangup')
  }

  return (
    <div className="jitsi-room">
      <div className="mb-2 flex gap-2">
        <button className="btn" onClick={toggleAudio}>{audioMuted ? 'Unmute' : 'Mute'}</button>
        <button className="btn" onClick={toggleVideo}>{videoMuted ? 'Start video' : 'Stop video'}</button>
        <button className="btn btn-danger" onClick={hangup}>Leave</button>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '600px' }} />
    </div>
  )
}
