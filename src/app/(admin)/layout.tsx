import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import AdminSidebar from '@/components/admin/AdminSidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  if (!session) redirect('/staff-login')
  if (session.user.role === 'CLIENT') redirect('/dashboard')

  return (
    <div className="min-h-screen bg-zinc-950 flex">
      <AdminSidebar user={session.user} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
