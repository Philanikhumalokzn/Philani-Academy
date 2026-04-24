# Google Play Release Checklist

This repo is cleaner now, but the Android app is not yet ready for Google Play submission.

## Cleanup completed

- Removed tracked root build/test logs and local verification artifacts.
- Removed archived duplicate app copies from source control.
- Removed standalone helper sandbox projects that are not part of the production app.
- Expanded `.gitignore` to keep generated logs, IDE state, Playwright output, and archived folders out of git.

## Release blockers still open

### 1. Payment policy

The app currently exposes subscription flows backed by PayFast and Stripe:

- `pages/subscribe.tsx`
- `pages/api/payfast/checkout.ts`
- `pages/api/payfast/create-plan.ts`
- `pages/api/stripe/create-checkout-session.ts`

If Android users buy digital access or subscriptions inside the app, Google Play typically requires Google Play Billing instead of external web checkout. This needs a policy decision before release.

### 2. Android app versioning

Current Android release values are:

- `android/app/build.gradle`: `versionCode 1`
- `android/app/build.gradle`: `versionName "1.0.0"`

These are technically valid for a first Play upload, but should be treated as the initial release version baseline.

### 3. Release hardening

Current release config:

- `android/app/build.gradle`: `minifyEnabled true`
- `android/app/build.gradle`: `shrinkResources true`
- `android/app/src/main/AndroidManifest.xml`: `android:allowBackup="false"`

Signed release AAB generation has been verified locally with Gradle.

### 4. Store assets and compliance

Before submission, prepare:

- Final launcher icon and adaptive icon
- Feature graphic, screenshots, and Play listing copy
- Privacy policy URL and Data safety answers
- Support contact details
- App signing/upload keystore

### 5. Native release verification

Before generating the final App Bundle:

- Confirm `android/app/google-services.json` is the production Firebase config.
- Build a signed release AAB.
- Test sign-in, push notifications, subscription gating, and file/PDF handling on a physical Android device.

Status:

- Signed AAB successfully built at `android/app/build/outputs/bundle/release/app-release.aab`.
- Release signing verified with local keystore `android/app/philani-academy-upload.jks`.

## Suggested order

1. Decide whether Android subscriptions will use Play Billing or a compliant external purchase model.
2. Set Android versioning and release flags.
3. Generate final icons/splash assets.
4. Build and test a signed release bundle.
5. Complete Play Console listing and compliance forms.