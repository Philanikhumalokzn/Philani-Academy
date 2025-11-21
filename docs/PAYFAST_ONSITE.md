# PayFast Onsite Subscription Flow

This project now supports PayFast's onsite (inline) subscription checkout so learners never leave the Philani Academy site during payment.

## Environment variables

Set the following values in Vercel (or `.env.local` for local runs):

```
PAYFAST_MERCHANT_ID=xxxx
PAYFAST_MERCHANT_KEY=xxxx
PAYFAST_PASSPHRASE=optional-but-recommended
PAYFAST_SANDBOX=true               # use "false" once you go live
NEXT_PUBLIC_PAYFAST_ONSITE=1       # enables the client-side flow
NEXT_PUBLIC_PAYFAST_SANDBOX=true   # mirror PAYFAST_SANDBOX for the browser
NEXTAUTH_URL=https://your-production-host
```

Optional:

```
APP_BASE_URL=https://staging-host     # only if NEXTAUTH_URL is not set
NEXT_PUBLIC_PAYFAST_SCRIPT_URL=https://sandbox.payfast.co.za/onsite/engine.js
```

## How the flow works

1. A learner picks a plan on `/subscribe` and clicks **Subscribe with PayFast**.
2. The frontend calls `POST /api/payfast/onsite-token` with the selected plan.
3. The API route signs a subscription request, posts it to PayFast's Onsite endpoint and returns the `uuid` token.
4. The browser launches the PayFast secure iframe using `window.payfast_do_onsite_payment({ uuid })`.
5. PayFast notifies this app via the existing Instant Transaction Notification (ITN) handler at `/api/payfast/notify`.
6. The ITN payload contains `custom_str1` (plan id) and `custom_str2` (user id) so you can reconcile active subscriptions.

## Testing checklist

- Use sandbox merchant credentials while `PAYFAST_SANDBOX=true`.
- Confirm `/api/payfast/onsite-token` returns a UUID when invoked from an authenticated session.
- Complete a sandbox payment and watch the browser status message along with server logs.
- Inspect the ITN webhook logs (`console` output) to ensure events are received.
- Toggle `PAYFAST_SANDBOX=false` _only_ once live credentials are available and tested.

Refer to the official PayFast documentation for advanced options like trial periods, ad-hoc billing and custom webhooks.
