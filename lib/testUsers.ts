export const SPECIAL_TEST_STUDENT_EMAIL = 'philanikhumalo111@gmail.com'

export function isSpecialTestStudentEmail(email: unknown) {
  if (typeof email !== 'string') return false
  return email.trim().toLowerCase() === SPECIAL_TEST_STUDENT_EMAIL
}
