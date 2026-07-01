import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import ClientSidebar from '@/components/client/ClientSidebar'

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  if (!session) redirect('/login')
  if (session.user.role !== 'CLIENT') redirect('/admin/dashboard')

  return (
    <div className="min-h-screen bg-zinc-950 flex">
      <ClientSidebar user={session.user} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
