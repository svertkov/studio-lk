import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { nextUrl } = req
  const session = req.auth
  const isLoggedIn = !!session

  const isAdminRoute = nextUrl.pathname.startsWith('/admin')
  const isClientRoute = ['/dashboard', '/projects', '/files', '/sessions', '/loyalty'].some(
    (p) => nextUrl.pathname.startsWith(p)
  )
  const isAuthRoute =
    nextUrl.pathname === '/login' || nextUrl.pathname === '/staff-login'

  if (isAuthRoute && isLoggedIn) {
    const role = session?.user?.role
    if (role === 'CLIENT')
      return NextResponse.redirect(new URL('/dashboard', req.url))
    return NextResponse.redirect(new URL('/admin/dashboard', req.url))
  }

  if (isAdminRoute && !isLoggedIn) {
    return NextResponse.redirect(new URL('/staff-login', req.url))
  }

  if (isClientRoute && !isLoggedIn) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
})

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
