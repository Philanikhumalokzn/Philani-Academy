// South African ID utilities: parse birth date and validate checksum (Luhn-like)
// SA ID format: YYMMDD SSSS C A Z (13 digits)
// - Birthdate: YYMMDD (first 6)
// - Citizenship (C) and other digits ignored here
// - Z is a Luhn checksum

export type SAIdParseResult = {
  birthDate?: Date
  valid: boolean
  reason?: string
}

function luhnChecksum(num: string): number {
  let sum = 0
  let shouldDouble = false
  // Process from right to left
  for (let i = num.length - 1; i >= 0; i--) {
    let digit = parseInt(num[i], 10)
    if (shouldDouble) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    shouldDouble = !shouldDouble
  }
  return sum % 10
}

export function parseSouthAfricanId(idNumber: string): SAIdParseResult {
  const clean = (idNumber || '').replace(/\D+/g, '')
  if (clean.length !== 13) return { valid: false, reason: 'ID must be 13 digits' }
  if (!/^\d{13}$/.test(clean)) return { valid: false, reason: 'Invalid characters' }

  // Luhn check
  const checksum = luhnChecksum(clean)
  if (checksum !== 0) return { valid: false, reason: 'Checksum failed' }

  const yy = parseInt(clean.slice(0, 2), 10)
  const mm = parseInt(clean.slice(2, 4), 10)
  const dd = parseInt(clean.slice(4, 6), 10)
  if (mm < 1 || mm > 12) return { valid: false, reason: 'Invalid month' }
  if (dd < 1 || dd > 31) return { valid: false, reason: 'Invalid day' }

  // Century heuristic: assume 2000+ for yy <= current YY, else 1900+
  const now = new Date()
  const currentYY = now.getFullYear() % 100
  const century = yy <= currentYY ? 2000 : 1900
  const year = century + yy

  const birthStr = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  const birthDate = new Date(birthStr + 'T00:00:00.000Z')
  if (isNaN(birthDate.getTime())) return { valid: false, reason: 'Invalid date' }

  return { valid: true, birthDate }
}
