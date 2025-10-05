import React, { useEffect, useRef } from 'react'

type Props = {
  roomName: string
  displayName?: string
}

export default function JitsiRoom({ roomName, displayName }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<any>(null)

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
      } catch (err) {
        console.error('Failed to create Jitsi API', err)
      }
    }).catch(err => console.error(err))

    return () => {
      mounted = false
      try { apiRef.current?.dispose() } catch (e) {}
    }
  }, [roomName])

  return (
    <div className="jitsi-room">
      <div ref={containerRef} style={{ width: '100%', height: '600px' }} />
    </div>
  )
}
