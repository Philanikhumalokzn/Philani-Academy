const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { Pool } = require('pg')

const normalize = (v) => {
  const t = String(v ?? '').trim()
  if (!t) return ''
  const m = [...t.matchAll(/(\d+(?:\.\d+)*)/g)].map((x) => x[1]).filter(Boolean)
  if (!m.length) return ''
  return m.sort((a, b) => {
    const d = b.split('.').length - a.split('.').length
    if (d !== 0) return d
    return b.length - a.length
  })[0] || ''
}

const cmp = (a, b) => {
  const p = (v) => {
    const m = String(v || '').match(/(\d+(?:\.\d+)*)/)
    return m?.[1] ? m[1].split('.').map(Number).filter(Number.isFinite) : []
  }
  const pa = p(a)
  const pb = p(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

const sections = (mmd) => {
  const out = new Map()
  const lines = String(mmd || '').split(/\r?\n/)
  let root = ''
  let bucket = []

  const flush = () => {
    if (!root) return
    const block = bucket.join('\n').trim()
    if (block) out.set(root, block)
  }

  for (const raw of lines) {
    const line = String(raw || '')
    const t = line.trim()
    const h = t.match(/(?:\\section\*\{\s*QUESTION\s+(\d+)\s*\}|^QUESTION\s+(\d+)\b)/i)
    if (h?.[1] || h?.[2]) {
      flush()
      root = String(h[1] || h[2] || '').trim()
      bucket = [line]
      continue
    }
    if (!root) continue
    bucket.push(line)
  }

  flush()
  return out
}

const qFromSection = (section, root) => {
  const values = new Set()
  const r = normalize(root)
  if (r) values.add(r)

  for (const raw of String(section || '').split(/\r?\n/)) {
    const line = String(raw || '').trim()
    if (!line) continue
    const m = line.match(/^Q?((?:\d+)(?:\.\d+){0,6})\b/)
    const q = normalize(m?.[1] || '')
    if (!q) continue
    if (r && !(q === r || q.startsWith(`${r}.`))) continue
    values.add(q)
  }

  return Array.from(values).sort(cmp)
}

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
  try {
    const sources = await prisma.resourceBankItem.findMany({
      where: { grade: 'GRADE_12', parsedJson: { not: null } },
      select: {
        id: true,
        year: true,
        examCycle: true,
        sessionMonth: true,
        paper: true,
        title: true,
        sourceName: true,
        parsedJson: true,
      },
      orderBy: { id: 'asc' },
    })

    const rows = []
    for (const s of sources) {
      const mmd = typeof s?.parsedJson?.raw?.mmd === 'string' ? String(s.parsedJson.raw.mmd).trim() : ''
      if (!mmd) continue
      const secs = sections(mmd)
      let qs = []
      for (const [root, sec] of secs.entries()) qs = qs.concat(qFromSection(sec, root))
      qs = Array.from(new Set(qs)).sort(cmp)
      if (!qs.length) continue

      const anns = await prisma.questionAnnotation.findMany({
        where: { sourceId: s.id, questionNumber: { in: qs } },
        select: { questionNumber: true, cognitiveLevel: true },
      })
      const by = new Map(anns.map((a) => [normalize(a.questionNumber), a]))
      const missing = qs.filter((q) => {
        const a = by.get(normalize(q))
        return a?.cognitiveLevel == null
      })

      if (missing.length) {
        rows.push({
          id: s.id,
          year: s.year,
          examCycle: s.examCycle,
          sessionMonth: s.sessionMonth,
          paper: s.paper,
          sourceName: s.sourceName,
          title: s.title,
          missing,
        })
      }
    }

    console.log(JSON.stringify({ papersWithMissing: rows.length, totalMissing: rows.reduce((n, r) => n + r.missing.length, 0), rows }, null, 2))
  } finally {
    await prisma.$disconnect().catch(() => {})
    await pool.end().catch(() => {})
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
