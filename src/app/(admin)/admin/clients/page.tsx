import { getClients, getClientsStats } from '@/lib/actions/clients'
import { getPendingScheduleClients } from '@/lib/actions/schedule'
import ClientsSection from './ClientsSection'

export default async function ClientsPage() {
  const [clientsResult, statsResult, pendingResult] = await Promise.all([
    getClients(),
    getClientsStats(),
    getPendingScheduleClients(),
  ])

  return (
    <ClientsSection
      initialClients={clientsResult.data}
      stats={statsResult}
      dbConnected={clientsResult.ok}
      pendingScheduleEvents={pendingResult.data}
    />
  )
}
