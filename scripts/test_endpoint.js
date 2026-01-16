const url = process.argv[2]
if (!url) { console.error('Usage: node test_endpoint.js <url>'); process.exit(1) }

async function run() {
  try {
    console.log('--- GET /api/signup ---')
    const g = await fetch(url + '/api/signup', { method: 'GET' })
    console.log('Status:', g.status)
    const gt = await g.text()
    console.log('Body:', gt)
  } catch (e) {
    console.error('GET error', e)
  }

  try {
    console.log('\n--- POST /api/signup ---')
    const body = { name: 'Test User', email: 'debug+test@philani.academy', password: 'TestPass123' }
    const p = await fetch(url + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    console.log('Status:', p.status)
    const pt = await p.text()
    try { console.log('JSON:', JSON.parse(pt)) } catch (e) { console.log('Body:', pt) }
  } catch (e) {
    console.error('POST error', e)
  }
}

run()
