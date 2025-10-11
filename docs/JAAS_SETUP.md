JaaS (8x8) setup for Philani Academy (local dev)

This document shows exactly where to find the values in the 8x8 JaaS dashboard and how to run the app locally with the required environment variables. Follow these steps on your development machine.

1) Get values from the JaaS dashboard
- Login to https://jaas.8x8.vc (or wherever your JaaS console is hosted).
- Select your app / deployment (e.g. "My sample app").
- Copy the external API URL shown in the sample embed code. It looks like:
  `https://8x8.vc/<deployment-id>/external_api.js`
  - Set `NEXT_PUBLIC_JITSI_API_URL` to this value.
  - The domain portion (`8x8.vc`) is `NEXT_PUBLIC_JITSI_DOMAIN`.

- Go to **API keys** or **Provisioning** (left menu). There are two possible flows:
  - If you can generate an RSA key pair (private key + kid): download the private key (PEM) and copy the key id (kid). Use the RSA/RS256 flow below.
  - If the UI only gives an API key + API secret, copy those and use the HS256 fallback (less recommended).

RS256 values to collect:
- `JAAS_PRIVATE_KEY` — download the private key file (keep it on your machine only).
- `JAAS_KEY_ID` — the kid value shown in the dashboard for that key.
- `JAAS_APP_ID` — often the deployment id or an app id value displayed on the deployment page.

HS256 fallback values (if RSA keys are not available):
- `JITSI_JAAS_APP_ID`, `JITSI_JAAS_API_KEY`, `JITSI_JAAS_API_SECRET`

2) Prepare local secrets (PowerShell)

- Create a folder to hold keys (optional):
```powershell
mkdir C:\Users\$env:USERNAME\.philani_keys
```

- Save the downloaded private key to `C:\Users\$env:USERNAME\.philani_keys\jaas_private.key` (or another path you choose).

- Generate `ROOM_SECRET` and `NEXTAUTH_SECRET` (one-liners — copy output somewhere safe):
```powershell
# ROOM_SECRET
$bytes = New-Object 'System.Byte[]' 32; (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes); $roomSecret = [Convert]::ToBase64String($bytes); $roomSecret

# NEXTAUTH_SECRET
$bytes = New-Object 'System.Byte[]' 32; (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes); $nextAuth = [Convert]::ToBase64String($bytes); $nextAuth
```

3) How to run Next.js locally (PowerShell session) — recommended

- Open PowerShell in the repo root and run these commands (replace placeholders):
```powershell
# frontend / JaaS values
$env:NEXT_PUBLIC_JITSI_DOMAIN = '8x8.vc'
$env:NEXT_PUBLIC_JITSI_API_URL = 'https://8x8.vc/<deployment-id>/external_api.js'

# load private key into environment
$env:JAAS_PRIVATE_KEY = Get-Content 'C:\Users\<you>\.philani_keys\jaas_private.key' -Raw
$env:JAAS_KEY_ID = '<your-kid-here>'
$env:JAAS_APP_ID = '<your-jaas-app-id>'

# If you only have API key/secret instead of private key use these instead
# $env:JITSI_JAAS_APP_ID = '<your-app-id>'
# $env:JITSI_JAAS_API_KEY = '<your-api-key>'
# $env:JITSI_JAAS_API_SECRET = '<your-api-secret>'

# app secrets
$env:ROOM_SECRET = '<paste-room-secret-here>'
$env:NEXTAUTH_SECRET = '<paste-nextauth-secret-here>'

npm run dev
```

Notes:
- Setting `$env:VAR = 'value'` only affects the current PowerShell session. If you open a new terminal you must set them again or create a `.env.local` file (see below).
- Storing the private key on disk and calling `Get-Content -Raw` keeps long newlines intact — this is the preferred approach.

4) Alternative: `.env.local` (do not commit this file)
- Create `.env.local` in the project root and copy values from `.env.local.example`.
- Do NOT paste the private key PEM into `.env.local` unless you escape newlines as `\n` — instead prefer to keep the private key file and load it at runtime with `Get-Content` as shown above.

5) Verify it works
- Start dev server and login to the app UI.
- Open DevTools → Network → join a session.
- Confirm request to `/api/sessions/<id>/token` returns JSON `{ token: '...' , roomName: '...' }`.
- Paste token into https://jwt.io to inspect header/payload. Confirm `alg: RS256` and `kid` present (if using RS256).
- If the token is valid the demo popup will no longer appear.

6) If you want me to help further
- I can open a PR that adds these docs and the `.env.local.example` (already done) — you can then copy `.env.local.example` to `.env.local` and paste your non-secret values.
- If you prefer I can also generate the `.env.local` file for you if you paste non-secret values (deployment id, kid). I will NOT accept private keys pasted here for security — instead you should keep the private key file on your machine and load it as shown above.
