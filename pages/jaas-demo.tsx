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
