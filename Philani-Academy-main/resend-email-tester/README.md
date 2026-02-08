# Resend Email Tester

Disposable Node.js utility for manually verifying Resend email delivery.

## Setup

1. Copy `.env.example` to `.env` and fill in real values:
   - `RESEND_API_KEY` – live Resend API key
   - `MAIL_FROM` – must use a sender at your verified domain, e.g. `Philani Academy <no-reply@philaniacademy.org>`
   - `MAIL_TO` – default inbox for tests (form input overrides it)
2. Install dependencies and start the server:

```powershell
cd resend-email-tester
npm install
npm start
```

3. Visit `http://localhost:4000` and use the form to send yourself a test email. Responses are shown inline and full delivery data appears in the terminal/Resend dashboard.

## Notes

- API key stays server-side; the browser never sees it.
- Change or remove this folder once you finish testing to avoid keeping extra tooling in the main repo.
