import React, { useEffect, useRef } from 'react';

type Props = {
  roomName: string;
  sessionId?: string; // optional: used to fetch a JWT from /api/sessions/[id]/token
  height?: string | number;
};

export default function SimpleJitsiEmbed({ roomName, sessionId, height = '600px' }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const apiUrl = process.env.NEXT_PUBLIC_JITSI_API_URL ||
      'https://8x8.vc/vpaas-magic-cookie-06c4cf69d5104db0a1814b907036bfa4/external_api.js';
    const domain = process.env.NEXT_PUBLIC_JITSI_DOMAIN || '8x8.vc';

    let mounted = true;
    let apiInstance: any = null;

    const script = document.createElement('script');
    script.src = apiUrl;
    script.async = true;

    script.onload = async () => {
      if (!mounted) return;

      try {
        let token: string | undefined;
        const isOwner = Boolean((window as any).__JITSI_IS_OWNER__)
        const mustBeModerator = isOwner && !!sessionId
        const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))
        let effectiveRoomName = roomName
        const fetchTokenOnce = async () => {
          if (!sessionId) return undefined
          try {
            const res = await fetch(`/api/sessions/${sessionId}/token`, { cache: 'no-store', credentials: 'same-origin' });
            if (res.ok) {
              const body = await res.json();
              if (body?.roomName) {
                // Replace provided roomName with authoritative one from server
                effectiveRoomName = body.roomName
              }
              return body?.token as string | undefined
            }
          } catch {}
          return undefined
        }

        // DEV override: allow quick testing with a token from the URL
        // Usage: append ?jaas_token=<your_token> to the page or set window.JAAS_TEST_TOKEN
        // This is intentionally only enabled in non-production to avoid accidental leaks.
        if (process.env.NODE_ENV !== 'production') {
          try {
            const urlParams = new URLSearchParams(window.location.search);
            const qp = urlParams.get('jaas_token');
            if (qp) {
              token = qp;
              // eslint-disable-next-line no-console
              console.log('[DEV] Using jaas_token from URL override (short):', token.slice(0, 48) + '...')
            } else if ((window as any).JAAS_TEST_TOKEN) {
              token = (window as any).JAAS_TEST_TOKEN
              // eslint-disable-next-line no-console
              console.log('[DEV] Using jaas_token from window.JAAS_TEST_TOKEN (short):', String(token).slice(0,48) + '...')
            }
          } catch (e) { /* ignore */ }
        }

        if (!token && sessionId) {
          // Moderators: retry a few times to ensure we get a token before joining
          let attempts = mustBeModerator ? 3 : 1
          while (attempts-- > 0 && !token) {
            token = await fetchTokenOnce()
            if (token || !mustBeModerator) break
            await sleep(600)
          }
        }

        // DEV: log token/room used to initialize Jitsi
        if (process.env.NODE_ENV !== 'production') {
          try {
            const short = token ? token.split('.').slice(0,2).join('.') + '...' : 'no-token'
            // eslint-disable-next-line no-console
            console.log('[DEV] SimpleJitsiEmbed initializing with token:', short, 'room:', roomName)
          } catch (e) {}
        }

        // @ts-ignore this global is added by the external_api.js script
        const Jitsi = (window as any).JitsiMeetExternalAPI;
        if (!Jitsi) {
          console.error('JitsiMeetExternalAPI not available after script load');
          return;
        }

        apiInstance = new Jitsi(domain, {
          roomName: effectiveRoomName,
          parentNode: containerRef.current,
          jwt: token,
        });

        // attach to window for debugging if needed
        (window as any).__jitsiApi = apiInstance;

        // Best-effort: if this client is a moderator (owner/admin), enable lobby automatically
        const maybeEnableLobby = () => {
          try {
            const isOwner = Boolean((window as any).__JITSI_IS_OWNER__)
            if (!isOwner || !apiInstance) return
            try { apiInstance.executeCommand('toggleLobby', true); return } catch (_) {}
            try { apiInstance.executeCommand('lobby.enable', true); return } catch (_) {}
            try { apiInstance.executeCommand('toggleLobby'); return } catch (_) {}
            if (typeof (apiInstance as any).setLobbyEnabled === 'function') {
              try { (apiInstance as any).setLobbyEnabled(true) } catch (_) {}
            }
          } catch (_) {}
        }
        try {
          apiInstance.addEventListener('videoConferenceJoined', maybeEnableLobby)
          apiInstance.addEventListener('participantRoleChanged', (e: any) => { if (e?.role === 'moderator') maybeEnableLobby() })
        } catch (_) {}
      } catch (err) {
        console.error('Failed to initialize Jitsi', err);
      }
    };

    script.onerror = (e) => {
      console.error('Failed to load JaaS external_api.js from', apiUrl, e);
    };

    document.body.appendChild(script);

    return () => {
      mounted = false;
      // remove script and dispose api if present
      if (apiInstance && typeof apiInstance.dispose === 'function') {
        try { apiInstance.dispose(); } catch (e) { /* ignore */ }
      }
      script.remove();
    };
  }, [roomName, sessionId]);

  return (
    <div style={{ width: '100%', height }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
