const prisma = require('../lib/prisma.cjs')

function titleCaseName(value) {
  const cleaned = String(value || '').trim()
  if (!cleaned) return ''
  return cleaned
    .split(/\s+/)
    .map(word => word
      .split(/([-'])/)
      .map(part => {
        if (!part || part === '-' || part === "'") return part
        return `${part.charAt(0).toUpperCase()}${part.slice(1)}`
      })
      .join('')
    )
    .join(' ')
}

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, firstName: true, lastName: true, middleNames: true, name: true }
  })

  let updatedCount = 0

  for (const user of users) {
    const nextFirstName = user.firstName ? titleCaseName(user.firstName) : user.firstName
    const nextLastName = user.lastName ? titleCaseName(user.lastName) : user.lastName
    const nextMiddleNames = user.middleNames ? titleCaseName(user.middleNames) : user.middleNames
    const nextDisplayName = `${nextFirstName || ''} ${nextMiddleNames ? `${nextMiddleNames} ` : ''}${nextLastName || ''}`.trim()

    const updates = {}
    if (nextFirstName !== user.firstName) updates.firstName = nextFirstName
    if (nextLastName !== user.lastName) updates.lastName = nextLastName
    if (nextMiddleNames !== user.middleNames) updates.middleNames = nextMiddleNames
    if (nextDisplayName && nextDisplayName !== user.name) updates.name = nextDisplayName

    if (Object.keys(updates).length > 0) {
      await prisma.user.update({ where: { id: user.id }, data: updates })
      updatedCount += 1
    }
  }

  console.log(`Normalized names for ${updatedCount} users.`)
  process.exit(0)
}

main().catch(err => {
  console.error('Failed to normalize user names', err)
  process.exit(1)
})
