import SignInScreen from '../components/SignInScreen'
import { getSession } from 'next-auth/react'

export default function Home() {
  return <SignInScreen />
}

export async function getServerSideProps(context: any) {
  const session = await getSession(context)
  if (session) {
    return {
      redirect: { destination: '/dashboard', permanent: false }
    }
  }
  return { props: {} }
}
