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

        if (sessionId) {
          // try to fetch a short lived JWT from our server endpoint
          const res = await fetch(`/api/sessions/${sessionId}/token`);
          if (res.ok) {
            const body = await res.json();
            token = body?.token;
          } else {
            console.warn('/api/sessions/[id]/token returned', res.status);
          }
        }

        // @ts-ignore this global is added by the external_api.js script
        const Jitsi = (window as any).JitsiMeetExternalAPI;
        if (!Jitsi) {
          console.error('JitsiMeetExternalAPI not available after script load');
          return;
        }

        apiInstance = new Jitsi(domain, {
          roomName,
          parentNode: containerRef.current,
          jwt: token,
        });

        // attach to window for debugging if needed
        (window as any).__jitsiApi = apiInstance;
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
