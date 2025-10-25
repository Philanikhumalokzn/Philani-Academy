import React, { useEffect, useRef } from 'react'

type Props = {
  roomName: string
  displayName?: string
  sessionId?: string | number | null
  isOwner?: boolean
}

export default function JitsiRoom({ roomName: initialRoomName, displayName, sessionId }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<any>(null)

  useEffect(() => {
    let mounted = true

    const loadScript = (url?: string) => {
      return new Promise<void>((resolve, reject) => {
        if ((window as any).JitsiMeetExternalAPI) return resolve()
        const script = document.createElement('script')
        // Strictly match the working HTML sample: use 8x8.vc and external_api.min.js
        script.src = url || 'https://8x8.vc/libs/external_api.min.js'
        script.async = true
        script.onload = () => resolve()
        script.onerror = () => reject(new Error('Failed to load Jitsi script'))
        document.body.appendChild(script)
      })
    }

    const init = async () => {
      try {
        // Strictly match the working HTML sample
        const domain = '8x8.vc'
        const apiUrl = 'https://8x8.vc/libs/external_api.min.js'

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

        // Minimal options exactly like the sample
        const options: any = {
          roomName,
          width: 500,
          height: 500,
          parentNode: containerRef.current,
          jwt: jwtToken,
        }

        // Instantiate with jwt at init
        apiRef.current = new (window as any).JitsiMeetExternalAPI(domain, options)
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

  return (
    <div className="jitsi-room">
      <div ref={containerRef} id="meeting" />
    </div>
  )
}
