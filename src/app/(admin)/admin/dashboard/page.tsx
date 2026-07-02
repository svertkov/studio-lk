import { startOfMonth, endOfMonth } from 'date-fns'
import { getClientsStats } from '@/lib/actions/clients'
import DashboardBody from './DashboardBody'

export default async function AdminDashboardPage() {
  const now = new Date()
  const monthStart = startOfMonth(now).toISOString()
  const monthEnd = endOfMonth(now).toISOString()

  const clientsStats = await getClientsStats()

  return (
    <DashboardBody
      clientsTotal={clientsStats.total}
      monthStart={monthStart}
      monthEnd={monthEnd}
      nowIso={now.toISOString()}
    />
  )
}
