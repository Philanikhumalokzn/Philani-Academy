import React from 'react';

export default function JaaSDemoPlaceholder() {
  return (
    <div style={{ padding: 24 }}>
      <h1>JaaS demo (protected)</h1>
      <p>
        The public static demo page has been removed to avoid exposing demo JWTs. If you need to access
        a test demo, please use the integrated demo at <code>/jaas-demo</code> while signed in as an admin,
        or generate a short-lived token via the server token endpoint.
      </p>
      <p>
        See <code>/docs/JAAS_SETUP.md</code> for instructions on how to configure JaaS credentials and run
        the integrated demo safely.
      </p>
    </div>
  );
}
import dynamic from 'next/dynamic';
import React from 'react';

// load SimpleJitsiEmbed dynamically to avoid SSR issues
const SimpleJitsiEmbed = dynamic(() => import('../components/SimpleJitsiEmbed'), { ssr: false });

export default function JaaSDemoPage() {
  const roomName = 'vpaas-magic-cookie-06c4cf69d5104db0a1814b907036bfa4/SampleAppAliveIntensitiesSurveyFerociously';
  return (
    <div style={{ height: '100vh' }}>
      <h1 style={{ textAlign: 'center' }}>JaaS demo page</h1>
      <div style={{ height: 'calc(100% - 56px)' }}>
        <SimpleJitsiEmbed roomName={roomName} height="calc(100% - 56px)" />
      </div>
    </div>
  );
}
