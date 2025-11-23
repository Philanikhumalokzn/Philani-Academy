import dynamic from 'next/dynamic';
import React from 'react';
import NavArrows from '../components/NavArrows';

// load SimpleJitsiEmbed dynamically to avoid SSR issues
const SimpleJitsiEmbed = dynamic(() => import('../components/SimpleJitsiEmbed'), { ssr: false });

export default function JaaSDemoPage() {
  const roomName = 'vpaas-magic-cookie-06c4cf69d5104db0a1814b907036bfa4/SampleAppAliveIntensitiesSurveyFerociously';
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <NavArrows backHref="/dashboard" />
      <h1 style={{ textAlign: 'center' }}>JaaS demo page</h1>
      <div style={{ flex: 1 }}>
        <SimpleJitsiEmbed roomName={roomName} height="100%" />
      </div>
    </div>
  );
}
