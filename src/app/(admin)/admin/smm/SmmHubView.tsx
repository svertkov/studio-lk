'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { LayoutDashboard, Users2, Film, Wallet, UserCheck } from 'lucide-react'
import type { SmmProjectSummaryDTO, SmmDashboardStats, SmmClientPaymentDTO, SmmWorkItemDTO, SmmContentItemDTO, SmmProjectMembershipDTO } from '@/lib/actions/smm'
import type { StaffUserDTO } from '@/lib/actions/users'
import SmmOverviewTab from './SmmOverviewTab'
import SmmClientsTab from './SmmClientsTab'
import SmmPayoutsTab from './SmmPayoutsTab'
import SmmTeamTab from './SmmTeamTab'

type Tab = 'overview' | 'clients' | 'payouts' | 'team'

// «Производство» — реальная ссылка на отдельный route (не переключение
// вкладки внутри этого клиентского компонента, ТЗ 2B п.3: "Production —
// отдельный route, не завязанный на состояние вкладки"), поэтому она не
// часть TABS/Tab, а отдельный <Link> в той же навигационной строке.
// Замещает бывшую вкладку «Контент» (SmmContentTab.tsx, удалён) —
// повседневная работа с контентом теперь идёт через глобальный экран
// Production, а не через список внутри хаба (docs/business/SMM.md, «Production»).
const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Обзор', icon: LayoutDashboard },
  { key: 'clients', label: 'Клиенты', icon: Users2 },
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
      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 w-fit overflow-x-auto">
        {TABS.map((t, i) => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <Fragment key={t.key}>
              {i === 1 && (
                <Link
                  href="/admin/smm/production"
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors text-zinc-400 hover:text-zinc-200 whitespace-nowrap"
                >
                  <Film className="w-4 h-4" />
                  Производство
                </Link>
              )}
              <button
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            </Fragment>
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
        />
      )}
      {tab === 'clients' && (
        <SmmClientsTab projects={projects} setProjects={setProjects} clients={clients} content={initialContent} />
      )}
      {tab === 'payouts' && <SmmPayoutsTab initialUnpaidWork={initialUnpaidWork} />}
      {tab === 'team' && <SmmTeamTab projects={projects} staff={staff} initialMembers={initialMembers} />}
    </div>
  )
}
