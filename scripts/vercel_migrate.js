const { execSync } = require('child_process');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withConnectTimeout(url) {
  if (!url || typeof url !== 'string') return url;
  // If already set, leave it.
  if (/connect_timeout=/i.test(url)) return url;
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}connect_timeout=15`;
}

async function main() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    console.warn('DATABASE_URL is not set; skipping prisma migrate deploy.');
    return;
  }

  // Vercel can occasionally hit transient DB timeouts; retry a few times.
  const attempts = 3;
  const baseDelayMs = 1500;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const env = { ...process.env, DATABASE_URL: withConnectTimeout(rawUrl) };
    try {
      console.log(`Running prisma migrate deploy (attempt ${attempt}/${attempts})...`);
      execSync('npx prisma migrate deploy', { stdio: 'inherit', env });
      return;
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      const stderr = String(err && err.stderr ? err.stderr : '');
      const combined = `${message}\n${stderr}`;
      const isTimeout = /P1002|timed out|timeout/i.test(combined);
      if (!isTimeout || attempt === attempts) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`Prisma migrate timed out; retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
