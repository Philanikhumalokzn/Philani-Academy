In-page Jitsi demo (console snippet)
=================================

This file contains a small copy-pasteable browser console snippet that will:

- Fetch a signed token and room name from the app's API for the current session ID.
- Inject a Jitsi Meet external API iframe into the current page so you can test joining without relying on the existing UI buttons (helps around popup blockers).

How to use
----------

1. Open the browser on a page that has a session id in the URL, for example:

   https://your-app.example/sessions/00000000-0000-0000-0000-000000000000

   Replace the id above with a real session id from your app.

2. Open the browser DevTools console.

3. Paste the snippet below and press Enter.

Snippet
-------

Paste the entire block below into the console. It will attempt to fetch `/api/sessions/{id}/token`, decode the JSON response, then create an iframe pointing to the configured Jitsi domain and attach the JWT as required.

(() => {
  // Replace this selector with the correct session id extractor if needed.
  const sessionId = window.location.pathname.split('/').pop();
  if (!sessionId) return console.error('No session id found in URL.');

  async function loadTokenAndInject() {
    try {
      console.log('Fetching token for session', sessionId);
      const res = await fetch(`/api/sessions/${sessionId}/token`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Token request failed: ' + res.status + ' ' + res.statusText);
      const body = await res.json();
      console.log('Token response', body);

      const { jwt, roomName } = body;
      if (!jwt || !roomName) throw new Error('Response missing jwt or roomName');

      // Remove any existing demo element
      const existing = document.getElementById('in-page-jitsi-demo');
      if (existing) existing.remove();

      // Create container
      const container = document.createElement('div');
      container.id = 'in-page-jitsi-demo';
      container.style.position = 'fixed';
      container.style.right = '12px';
      container.style.bottom = '12px';
      container.style.width = '420px';
      container.style.height = '320px';
      container.style.zIndex = '99999';
      container.style.border = '2px solid rgba(0,0,0,0.12)';
      container.style.borderRadius = '8px';
      container.style.overflow = 'hidden';
      container.style.boxShadow = '0 6px 18px rgba(0,0,0,0.2)';
      container.style.background = '#fff';

      const header = document.createElement('div');
      header.style.padding = '6px 8px';
      header.style.fontSize = '12px';
      header.style.background = '#fafafa';
      header.style.borderBottom = '1px solid #eee';
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.innerHTML = `<strong style="font-weight:600">Jitsi demo</strong>`;

      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close';
      closeBtn.style.fontSize = '12px';
      closeBtn.style.padding = '4px 8px';
      closeBtn.style.marginLeft = '8px';
      closeBtn.onclick = () => container.remove();
      header.appendChild(closeBtn);

      const iframe = document.createElement('iframe');
      iframe.style.border = '0';
      iframe.style.width = '100%';
      iframe.style.height = '100%';

      // Construct a simple URL that uses your configured Jitsi domain and passes the JWT
      // If your app uses Next's NEXT_PUBLIC_JITSI_DOMAIN or similar, adjust accordingly.
      const jitsiDomain = window.__NEXT_PUBLIC_JITSI_DOMAIN || window.NEXT_PUBLIC_JITSI_DOMAIN || 'meet.jit.si';
      // The JWT is usually passed to the external API; here we use a simple direct URL for testing
      // If your deployment expects the JWT as query param for a static demo page, set it accordingly.
      // We'll attempt to load the public demo page from this repo if present.
      const demoUrl = `${location.origin}/jaas-demo.html#room=${encodeURIComponent(roomName)}&jwt=${encodeURIComponent(jwt)}`;

      iframe.src = demoUrl;

      container.appendChild(header);
      container.appendChild(iframe);

      document.body.appendChild(container);

      console.log('Injected in-page Jitsi demo iframe. Use the Close button to remove it.');
    } catch (err) {
      console.error('In-page Jitsi demo failed', err);
    }
  }

  loadTokenAndInject();
})();

Teardown
--------

To remove the injected demo, run:

document.getElementById('in-page-jitsi-demo')?.remove();

Troubleshooting
---------------

- If the token fetch returns 401/403, make sure you're signed in and the session id belongs to your user.
- If the iframe shows "Authentication failed", then double-check the server-signed JWT. Use `/api/jaas/health` to verify environment variables and signatures.
- If the iframe is blank or blocked, try opening the `demoUrl` directly in a new tab (copy URL shown in console) to see any errors.
