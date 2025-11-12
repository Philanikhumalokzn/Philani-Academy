import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import prisma from '../../../lib/prisma'
import bcrypt from 'bcryptjs'

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
          return { id: user.id, name: user.name, email: user.email }
        } catch (err: any) {
          // When DEBUG=1 we want to surface errors in logs to help diagnose production failures.
          if (process.env.DEBUG === '1') console.error('NextAuth authorize error:', err)
          // Fail the signin attempt without leaking details to the client.
          return null
        }
      }
    })
  ],
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user }) {
      // Attach role from database user on sign in
      if (user) {
        try {
          const dbUser = await prisma.user.findUnique({ where: { email: token.email as string } })
          if (dbUser) token.role = dbUser.role
        } catch (err: any) {
          if (process.env.DEBUG === '1') console.error('NextAuth jwt callback error:', err)
        }
      }
      return token
    },
    async session({ session, token }) {
      (session as any).user.role = token.role
      return session
    }
  }
})
