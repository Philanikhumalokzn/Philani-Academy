import React from 'react';

// This page intentionally does not embed a live JaaS session to avoid exposing demo tokens in a public build.
// If you need to test the JaaS integration, sign in as an admin and use the internal flows described in docs.
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
