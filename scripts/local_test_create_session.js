const createSession = require('../lib/createSession')

async function main(){
  const token = { email: 'admin@philani.test', role: 'admin' }
  const body = { title: 'Local Helper Session', joinUrl: 'https://meet.example', startsAt: new Date().toISOString() }
  try{
    const rec = await createSession({ token, body })
    console.log('Created via helper:', rec)
    process.exit(0)
  }catch(e){
    console.error('Error:', e)
    process.exit(1)
  }
}

main()
