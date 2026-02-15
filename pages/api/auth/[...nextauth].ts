import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import prisma from '../../../lib/prisma'
import bcrypt from 'bcryptjs'
import { issueEmailVerification, isVerificationBypassed, requirePhoneVerification } from '../../../lib/verification'

export default NextAuth({
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        try {
          if (!credentials) return null
          const user = await prisma.user.findUnique({ where: { email: credentials.email } })
          if (!user) return null
          const ok = await bcrypt.compare(credentials.password, user.password)
          if (!ok) return null
          const userRecord = user as any
          const normalizedEmail = typeof userRecord.email === 'string' ? userRecord.email.trim().toLowerCase() : ''
          const skipVerification = isVerificationBypassed(normalizedEmail)
          if (!skipVerification) {
            if (!userRecord.emailVerifiedAt) {
              try {
                await issueEmailVerification(user.id, normalizedEmail)
              } catch (notificationErr) {
                if (process.env.DEBUG === '1') console.error('NextAuth issueEmailVerification error:', notificationErr)
              }
              throw new Error('Account pending verification. Check your email for the verification code we just sent.')
            }
            if (requirePhoneVerification() && !userRecord.phoneVerifiedAt) {
              throw new Error('Account pending phone verification. Please contact support.')
            }
          }
          return { id: user.id, name: user.name, email: user.email, role: user.role, grade: user.grade, image: user.avatar ?? undefined }
        } catch (err: any) {
          if (typeof err?.message === 'string' && err.message.toLowerCase().startsWith('account pending')) {
            throw err
          }
          // When DEBUG=1 we want to surface errors in logs to help diagnose production failures.
          if (process.env.DEBUG === '1') console.error('NextAuth authorize error:', err)
          // Fail the signin attempt without leaking details to the client.
          return null
        }
      }
    })
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  jwt: {
    maxAge: 30 * 24 * 60 * 60,
  },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: '/auth/signin',
    error: '/auth/signin'
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (trigger === 'update') {
        const nextImage =
          (typeof (session as any)?.image === 'string' ? (session as any).image.trim() : '') ||
          (typeof (session as any)?.user?.image === 'string' ? (session as any).user.image.trim() : '')
        if (nextImage) token.image = nextImage
      }
      // Attach role/grade from database user on sign in or when missing on the token
      if (user || !token.role || typeof token.grade === 'undefined' || typeof (token as any).image === 'undefined') {
        try {
          const dbUser = token.sub
            ? await prisma.user.findUnique({ where: { id: String(token.sub) } })
            : await prisma.user.findUnique({ where: { email: token.email as string } })
          if (dbUser) {
            token.role = dbUser.role
            token.grade = dbUser.grade
            if (dbUser.avatar) (token as any).image = dbUser.avatar
          }
          if (user) {
            const userData = user as any
            if (userData.role) token.role = userData.role
            if (typeof userData.grade !== 'undefined') token.grade = userData.grade
            if (typeof userData.image === 'string' && userData.image.trim()) (token as any).image = userData.image.trim()
          }
        } catch (err: any) {
          if (process.env.DEBUG === '1') console.error('NextAuth jwt callback error:', err)
        }
      }
      return token
    },
    async session({ session, token }) {
      const safeSession = session as any
      safeSession.user = safeSession.user || {}
      safeSession.user.role = token.role
      safeSession.user.grade = token.grade ?? null
      if (typeof (token as any)?.image === 'string' && (token as any).image.trim()) {
        safeSession.user.image = (token as any).image.trim()
      }
      return safeSession
    },
  }
})
