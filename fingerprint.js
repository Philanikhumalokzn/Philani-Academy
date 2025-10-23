// fingerprint.js
const fs = require('fs')
const crypto = require('crypto')
const pem = fs.readFileSync(process.argv[2], 'utf8') // e.g. priv.pem
let keyObj
try { keyObj = crypto.createPrivateKey(pem) } catch (e) { keyObj = crypto.createPublicKey(pem) }
const pubDer = keyObj.export({ type: 'spki', format: 'der' })
console.log(crypto.createHash('sha256').update(pubDer).digest('hex'))