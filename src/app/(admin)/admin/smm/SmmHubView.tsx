'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { LayoutDashboard, Users2, Film, Wallet, UserCheck, Calendar, BarChart3 } from 'lucide-react'
import type {
  SmmProjectSummaryDTO, SmmDashboardStats, SmmClientPaymentDTO, SmmWorkItemDTO, SmmContentItemDTO, SmmProjectMembershipDTO,
} from '@/lib/actions/smm'
import type { StaffUserDTO } from '@/lib/actions/users'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import SmmOverviewTab from './SmmOverviewTab'
import SmmClientsTab from './SmmClientsTab'
import SmmPayoutsTab from './SmmPayoutsTab'
import SmmTeamTab from './SmmTeamTab'

type Tab = 'overview' | 'clients' | 'payouts' | 'team'

// Целевая навигация SMM (следующий этап после 2B, docs/business/SMM.md,
// «Views»): Обзор / Производство / Календарь / Клиенты / Выплаты / Команда /
// Аналитика. Производство/Календарь/Аналитика — реальные отдельные routes
// (не переключение вкладки внутри этого клиентского компонента, тот же
// принцип, что уже применён к Production в 2B), вставлены прямо в
// навигационную строку через RAW_NAV ниже вместо попытки впихнуть их в
// TABS/Tab (эти три не имеют локального состояния вкладки вообще).
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
  editors: EditorProfileListItemDTO[]
}

export default function SmmHubView({
  initialProjects, initialStats, initialUpcomingPayments, initialUnpaidWork, initialContent, initialMembers, clients, staff, editors,
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
                <>
                  <Link href="/admin/smm/production" className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors text-zinc-400 hover:text-zinc-200 whitespace-nowrap">
                    <Film className="w-4 h-4" /> Производство
                  </Link>
                  <Link href="/admin/smm/calendar" className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors text-zinc-400 hover:text-zinc-200 whitespace-nowrap">
                    <Calendar className="w-4 h-4" /> Календарь
                  </Link>
                </>
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
        <Link href="/admin/smm/analytics" className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors text-zinc-400 hover:text-zinc-200 whitespace-nowrap">
          <BarChart3 className="w-4 h-4" /> Аналитика
        </Link>
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
      {tab === 'payouts' && <SmmPayoutsTab initialUnpaidWork={initialUnpaidWork} editors={editors} projects={projects} />}
      {tab === 'team' && <SmmTeamTab projects={projects} staff={staff} initialMembers={initialMembers} />}
    </div>
  )
}
