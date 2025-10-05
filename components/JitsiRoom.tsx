import React, { useEffect, useRef, useState } from 'react'

type Props = {
  roomName: string
  displayName?: string
  sessionId?: string | number | null
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
      const options = {
        roomName,
        parentNode: containerRef.current,
        interfaceConfigOverwrite: { TOOLBAR_BUTTONS: ['microphone', 'camera', 'hangup', 'tileview'] },
        configOverwrite: { disableDeepLinking: true },
        userInfo: { displayName: displayName || 'Learner' }
      }
      try {
        apiRef.current = new (window as any).JitsiMeetExternalAPI(domain, options)
        setLoaded(true)
        // Listen for audio/video mute changes
        apiRef.current.addEventListener('audioMuteStatusChanged', (e: any) => setAudioMuted(e.muted))
        apiRef.current.addEventListener('videoMuteStatusChanged', (e: any) => setVideoMuted(e.muted))

        // If a sessionId is provided, attempt to fetch the server-generated jitsiPassword
        // and apply it so admins become moderators and learners can join locked rooms.
        const applyPassword = async () => {
          try {
            if (!sessionId) return
            const res = await fetch(`/api/sessions/${sessionId}/password`, { credentials: 'same-origin' })
            if (!res.ok) return
            const data = await res.json().catch(() => null)
            const pw = data?.jitsiPassword
            if (pw && apiRef.current && typeof apiRef.current.executeCommand === 'function') {
              try {
                // `password` command sets the room password when run by a moderator.
                apiRef.current.executeCommand('password', pw)
              } catch (err) {
                // Some Jitsi instances may use setPassword or other commands; try both
                try { apiRef.current.executeCommand('setPassword', pw) } catch (e) {}
              }
            }
          } catch (err) {
            // ignore network errors
          }
        }
        // Apply password after a short delay to give Jitsi time to be fully ready
        setTimeout(() => { applyPassword() }, 800)
        
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
