import React from 'react'
import { useEffect, useRef, useState } from 'react'

type Props = {
  roomName: string
  displayName?: string
  sessionId?: string | number | null
  // Treat owner/admin as moderator for enabling lobby automatically
  isOwner?: boolean
}

export default function JitsiRoom({ roomName: initialRoomName, displayName, sessionId, isOwner }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<any>(null)
  const [audioMuted, setAudioMuted] = useState(false)
  const [videoMuted, setVideoMuted] = useState(false)
  const [lobbyEnabled, setLobbyEnabled] = useState<boolean>(false)

  useEffect(() => {
    let mounted = true

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

        const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

        const fetchTokenOnce = async (): Promise<{ token?: string; roomName?: string } | null> => {
          if (!sessionId) return null
          try {
            const tkRes = await fetch(`/api/sessions/${sessionId}/token`, { credentials: 'same-origin', cache: 'no-store' })
            if (!tkRes.ok) return null
            const tkJson = await tkRes.json().catch(() => null)
            return tkJson
          } catch {
            return null
          }
        }

        // Moderators must join with a token to bypass lobby consistently. If this user
        // is an owner/admin, wait and retry a few times for the token before initializing.
        const mustBeModerator = Boolean(isOwner || (window as any).__JITSI_IS_OWNER__)
        if (sessionId) {
          let attempts = mustBeModerator ? 3 : 1
          while (attempts-- > 0 && mounted) {
            const tkJson = await fetchTokenOnce()
            if (tkJson?.token || !mustBeModerator) {
              jwtToken = tkJson?.token
              if (tkJson?.roomName) roomName = tkJson.roomName
              break
            }
            await sleep(600)
          }
        }

        const options: any = {
          roomName,
          parentNode: containerRef.current,
          interfaceConfigOverwrite: { TOOLBAR_BUTTONS: ['microphone', 'camera', 'hangup', 'tileview'] },
          // Keep config minimal; prejoin can help users set devices before knocking
          configOverwrite: {
            disableDeepLinking: true,
            prejoinConfig: { enabled: true }
          },
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
        const enableLobbyIfModerator = () => {
          // Only attempt if we think this user is a moderator (owner/admin) or when the role flips to moderator
          const shouldEnable = Boolean(isOwner || (window as any).__JITSI_IS_OWNER__)
          if (!shouldEnable || !apiRef.current) return
          // Try known commands to enable the lobby; different deployments expose different APIs
          try {
            // Preferred: explicit enable if supported
            if (typeof apiRef.current.executeCommand === 'function') {
              try { apiRef.current.executeCommand('toggleLobby', true); setLobbyEnabled(true); return } catch (_) {}
              try { apiRef.current.executeCommand('lobby.enable', true); setLobbyEnabled(true); return } catch (_) {}
              // Fallback: plain toggle (best-effort)
              try { apiRef.current.executeCommand('toggleLobby'); setLobbyEnabled(prev => !prev); return } catch (_) {}
            }
            // Some builds expose an API method
            if (typeof apiRef.current.setLobbyEnabled === 'function') {
              try { apiRef.current.setLobbyEnabled(true); setLobbyEnabled(true); return } catch (_) {}
            }
          } catch (e) {
            // ignore errors; lobby may not be available or already enabled
          }
        }

        try {
          apiRef.current.addEventListener('audioMuteStatusChanged', (e: any) => setAudioMuted(e.muted))
          apiRef.current.addEventListener('videoMuteStatusChanged', (e: any) => setVideoMuted(e.muted))
          // When the local user joins, attempt to enable lobby if they are moderator
          apiRef.current.addEventListener('videoConferenceJoined', () => {
            enableLobbyIfModerator()
          })
          // If role changes to moderator after join (e.g., token upgrade), enable lobby then
          apiRef.current.addEventListener('participantRoleChanged', (e: any) => {
            if (e?.role === 'moderator') {
              enableLobbyIfModerator()
            }
          })
          // Surface knocking events for moderator; built-in UI shows a prompt, but logging helps during testing
          apiRef.current.addEventListener('knockingParticipant', (e: any) => {
            try { console.log('[JITSI] knockingParticipant:', e) } catch (_) {}
          })
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
