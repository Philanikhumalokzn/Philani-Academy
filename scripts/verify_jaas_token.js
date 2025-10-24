#!/usr/bin/env node
// Verify a JaaS RS256 JWT using a PEM public (or private) key.
// Usage examples:
//   node scripts/verify_jaas_token.js --token <JWT> --key-file ./jaas_public.pem
//   node scripts/verify_jaas_token.js --token-file ./token.txt --key "-----BEGIN PUBLIC KEY-----\n..."
//   TOKEN=$(curl -s .../api/debug/jaas-token?id=123 | jq -r .token) node scripts/verify_jaas_token.js --key-file ./jaas_public.pem

const fs = require('fs')
const path = require('path')
const jwt = require('jsonwebtoken')

function parseArgs() {
  const args = process.argv.slice(2)
  const out = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--token' && args[i+1]) { out.token = args[++i] }
    else if (a === '--token-file' && args[i+1]) { out.tokenFile = args[++i] }
    else if (a === '--key-file' && args[i+1]) { out.keyFile = args[++i] }
    else if (a === '--key' && args[i+1]) { out.key = args[++i] }
  }
  return out
}

function loadFileMaybe(p) {
  try { return fs.readFileSync(path.resolve(p), 'utf8') } catch (_) { return null }
}

async function main(){
  const args = parseArgs()
  let token = args.token || process.env.TOKEN || null
  if (!token && args.tokenFile) token = loadFileMaybe(args.tokenFile)
  if (!token) {
    console.error('Missing token. Provide --token, --token-file, or TOKEN env.')
    process.exit(2)
  }

  let key = args.key || process.env.JAAS_PUBLIC_KEY || null
  if (!key && args.keyFile) key = loadFileMaybe(args.keyFile)
  if (!key) {
    console.error('Missing key. Provide --key, --key-file, or JAAS_PUBLIC_KEY env.')
    process.exit(2)
  }

  try {
    const decoded = jwt.verify(token.trim(), key.trim(), { algorithms: ['RS256'] })
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64').toString('utf8'))
    console.log('Signature: VALID')
    console.log('Header  :', header)
    console.log('Payload :', decoded)
    process.exit(0)
  } catch (err) {
    console.error('Signature: INVALID')
    console.error(String(err))
    process.exit(1)
  }
}

main()
