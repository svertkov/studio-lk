import { getSmmProjectsSummary, getSmmDashboardStats, getUpcomingSmmClientPayments, getUnpaidApprovedWorkItems, getAllSmmContentItems, getAllActiveSmmProjectMembers } from '@/lib/actions/smm'
import { getClients } from '@/lib/actions/clients'
import { getStaffUsers } from '@/lib/actions/users'
import SmmHubView from './SmmHubView'

export default async function SmmPage() {
  const [projectsResult, statsResult, upcomingPaymentsResult, unpaidWorkResult, contentResult, clientsResult, staffResult, membersResult] = await Promise.all([
    getSmmProjectsSummary(),
    getSmmDashboardStats(),
    getUpcomingSmmClientPayments(),
    getUnpaidApprovedWorkItems(),
    getAllSmmContentItems(),
    getClients(),
    getStaffUsers(),
    getAllActiveSmmProjectMembers(),
  ])

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">SMM</h1>
        <p className="text-zinc-400 text-sm mt-1">Ведение соцсетей клиентов студии — проекты, контент, съёмки, выплаты</p>
      </div>

      <SmmHubView
        initialProjects={projectsResult.data}
        initialStats={statsResult.ok ? statsResult.data : null}
        initialUpcomingPayments={upcomingPaymentsResult.data}
        initialUnpaidWork={unpaidWorkResult.data}
        initialContent={contentResult.data}
        initialMembers={membersResult.data}
        clients={clientsResult.ok ? clientsResult.data : []}
        staff={staffResult.data}
      />
    </div>
  )
}
