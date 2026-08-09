'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, LayoutDashboard, Package, Film, Camera, Link2, Users2, Wallet } from 'lucide-react'
import type {
  SmmProjectDTO, SmmPackageItemDTO, SmmContentItemDTO, SmmMaterialLinkDTO,
  SmmProjectMemberDTO, SmmScheduleLinkDTO, SmmClientPaymentDTO, SmmWorkItemDTO,
} from '@/lib/actions/smm'
import type { EditorProfileListItemDTO } from '@/lib/actions/editors'
import type { StaffUserDTO } from '@/lib/actions/users'
import { SMM_PROJECT_STATUS_LABELS, formatSmmMoney } from '@/lib/smm-model'
import SmmProjectOverviewTab from './SmmProjectOverviewTab'
import SmmProjectPackageTab from './SmmProjectPackageTab'
import SmmProjectContentTab from './SmmProjectContentTab'
import SmmProjectShootsTab from './SmmProjectShootsTab'
import SmmProjectMaterialsTab from './SmmProjectMaterialsTab'
import SmmProjectTeamTab from './SmmProjectTeamTab'
import SmmProjectFinanceTab from './SmmProjectFinanceTab'

type Tab = 'overview' | 'package' | 'content' | 'shoots' | 'materials' | 'team' | 'finance'

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Обзор', icon: LayoutDashboard },
  { key: 'package', label: 'Пакет', icon: Package },
  { key: 'content', label: 'Контент', icon: Film },
  { key: 'shoots', label: 'Съёмки', icon: Camera },
  { key: 'materials', label: 'Материалы', icon: Link2 },
  { key: 'team', label: 'Команда', icon: Users2 },
  { key: 'finance', label: 'Финансы', icon: Wallet },
]

interface Props {
  initialProject: SmmProjectDTO
  initialPackageItems: SmmPackageItemDTO[]
  initialContentItems: SmmContentItemDTO[]
  initialMaterialLinks: SmmMaterialLinkDTO[]
  initialMembers: SmmProjectMemberDTO[]
  initialScheduleLinks: SmmScheduleLinkDTO[]
  initialClientPayments: SmmClientPaymentDTO[]
  unlinkedScheduleEvents: { id: string; title: string | null; startAt: string | null }[]
  editors: EditorProfileListItemDTO[]
  staff: StaffUserDTO[]
  initialWorkItems: SmmWorkItemDTO[]
}

export default function SmmProjectView({
  initialProject, initialPackageItems, initialContentItems, initialMaterialLinks, initialMembers,
  initialScheduleLinks, initialClientPayments, unlinkedScheduleEvents, editors, staff, initialWorkItems,
}: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [project, setProject] = useState(initialProject)
  const [packageItems, setPackageItems] = useState(initialPackageItems)
  const [contentItems, setContentItems] = useState(initialContentItems)
  const [materialLinks, setMaterialLinks] = useState(initialMaterialLinks)
  const [members, setMembers] = useState(initialMembers)
  const [scheduleLinks, setScheduleLinks] = useState(initialScheduleLinks)
  const [clientPayments, setClientPayments] = useState(initialClientPayments)
  const [workItems, setWorkItems] = useState(initialWorkItems)

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/smm" className="inline-flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-sm transition-colors mb-3">
          <ArrowLeft className="w-3.5 h-3.5" />
          SMM
        </Link>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white">{project.clientName ?? 'SMM-проект'}</h1>
            <p className="text-zinc-400 text-sm mt-1">
              {SMM_PROJECT_STATUS_LABELS[project.status]}
              {project.monthlyFee != null && ` · ${formatSmmMoney(project.monthlyFee)}/мес`}
            </p>
          </div>
          <Link href={`/admin/clients/${project.clientId}`} className="text-xs text-zinc-400 hover:text-white underline">
            Открыть карточку клиента
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 w-fit overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
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
        <SmmProjectOverviewTab project={project} setProject={setProject} packageItems={packageItems} contentItems={contentItems} clientPayments={clientPayments} members={members} />
      )}
      {tab === 'package' && <SmmProjectPackageTab smmProjectId={project.id} packageItems={packageItems} setPackageItems={setPackageItems} />}
      {tab === 'content' && (
        <SmmProjectContentTab
          smmProjectId={project.id}
          contentItems={contentItems}
          setContentItems={setContentItems}
          editors={editors}
          staff={staff}
          workItems={workItems}
          setWorkItems={setWorkItems}
        />
      )}
      {tab === 'shoots' && (
        <SmmProjectShootsTab
          smmProjectId={project.id}
          scheduleLinks={scheduleLinks}
          setScheduleLinks={setScheduleLinks}
          contentItems={contentItems}
          unlinkedScheduleEvents={unlinkedScheduleEvents}
        />
      )}
      {tab === 'materials' && (
        <SmmProjectMaterialsTab smmProjectId={project.id} materialLinks={materialLinks} setMaterialLinks={setMaterialLinks} contentItems={contentItems} />
      )}
      {tab === 'team' && <SmmProjectTeamTab smmProjectId={project.id} members={members} setMembers={setMembers} staff={staff} />}
      {tab === 'finance' && (
        <SmmProjectFinanceTab smmProjectId={project.id} clientPayments={clientPayments} setClientPayments={setClientPayments} project={project} setProject={setProject} />
      )}
    </div>
  )
}
