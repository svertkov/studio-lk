import { getClients, getClientsStats } from '@/lib/actions/clients'
import ClientsSection from './ClientsSection'

export default async function ClientsPage() {
  const [clientsResult, statsResult] = await Promise.all([
    getClients(),
    getClientsStats(),
  ])

  return (
    <ClientsSection
      initialClients={clientsResult.data}
      stats={statsResult}
      dbConnected={clientsResult.ok}
    />
  )
}
