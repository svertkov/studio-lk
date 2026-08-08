'use client'

import { useState } from 'react'
import { LayoutDashboard, Users2, Film, Wallet, UserCheck } from 'lucide-react'
import type { SmmProjectSummaryDTO, SmmDashboardStats, SmmClientPaymentDTO, SmmWorkItemDTO, SmmContentItemDTO, SmmProjectMembershipDTO } from '@/lib/actions/smm'
import type { StaffUserDTO } from '@/lib/actions/users'
import SmmOverviewTab from './SmmOverviewTab'
import SmmClientsTab from './SmmClientsTab'
import SmmContentTab from './SmmContentTab'
import SmmPayoutsTab from './SmmPayoutsTab'
import SmmTeamTab from './SmmTeamTab'

type Tab = 'overview' | 'clients' | 'content' | 'payouts' | 'team'

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Обзор', icon: LayoutDashboard },
  { key: 'clients', label: 'Клиенты', icon: Users2 },
  { key: 'content', label: 'Контент', icon: Film },
  { key: 'payouts', label: 'Выплаты', icon: Wallet },
  { key: 'team', label: 'Команда', icon: UserCheck },
]

interface ClientOption { id: string; name: string }

interface Props {
  initialProjects: SmmProjectSummaryDTO[]
  initialStats: SmmDashboardStats | null
  initialUpcomingPayments: SmmClientPaymentDTO[]
  initialUnpaidWork: SmmWorkItemDTO[]
  initialContent: SmmContentItemDTO[]
  initialMembers: SmmProjectMembershipDTO[]
  clients: ClientOption[]
  staff: StaffUserDTO[]
}

export default function SmmHubView({
  initialProjects, initialStats, initialUpcomingPayments, initialUnpaidWork, initialContent, initialMembers, clients, staff,
}: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [projects, setProjects] = useState(initialProjects)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 w-fit">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                active ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && (
        <SmmOverviewTab
          stats={initialStats}
          upcomingPayments={initialUpcomingPayments}
          unpaidWork={initialUnpaidWork}
          content={initialContent}
          onGoToClients={() => setTab('clients')}
          onGoToPayouts={() => setTab('payouts')}
          onGoToContent={() => setTab('content')}
        />
      )}
      {tab === 'clients' && (
        <SmmClientsTab projects={projects} setProjects={setProjects} clients={clients} content={initialContent} />
      )}
      {tab === 'content' && <SmmContentTab content={initialContent} projects={projects} />}
      {tab === 'payouts' && <SmmPayoutsTab initialUnpaidWork={initialUnpaidWork} />}
      {tab === 'team' && <SmmTeamTab projects={projects} staff={staff} initialMembers={initialMembers} />}
    </div>
  )
}
