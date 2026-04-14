/**
 * Format large numbers with K, M suffixes for social media display
 * @param count - The number to format
 * @returns Formatted string (e.g., "1.2K", "500", "2M")
 */
export function formatSocialCounter(count: number | null | undefined): string {
  if (!count || count <= 0) return ''
  
  const safeCount = Math.max(0, Math.trunc(count))
  
  if (safeCount >= 1_000_000) {
    const millions = safeCount / 1_000_000
    return millions >= 10 ? `${Math.floor(millions)}M` : `${millions.toFixed(1)}M`.replace(/\.0M$/, 'M')
  }
  
  if (safeCount >= 1_000) {
    const thousands = safeCount / 1_000
    return thousands >= 10 ? `${Math.floor(thousands)}K` : `${thousands.toFixed(1)}K`.replace(/\.0K$/, 'K')
  }
  
  return String(safeCount)
}

/**
 * Format label with count and proper singular/plural
 * @param count - The number
 * @param singular - Singular form (e.g., "Like")
 * @param plural - Plural form (e.g., "Likes")
 * @returns Formatted label like "1 Like" or "2 Likes" or "1.2K Likes"
 */
export function formatSocialCountLabel(
  count: number | null | undefined,
  singular: string,
  plural: string
): string {
  if (!count || count <= 0) return ''
  
  const safeCount = Math.max(0, Math.trunc(count))
  const formatted = formatSocialCounter(safeCount)
  
  // If it has K or M suffix, always use plural
  if (formatted.includes('K') || formatted.includes('M')) {
    return `${formatted} ${plural}`
  }
  
  // Otherwise check if singular or plural
  return safeCount === 1 ? `${formatted} ${singular}` : `${formatted} ${plural}`
}
