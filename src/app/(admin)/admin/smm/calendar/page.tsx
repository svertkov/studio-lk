import { getSmmProjects } from '@/lib/actions/smm'
import { getAllEditorProfiles } from '@/lib/actions/editors'
import { getStaffUsers } from '@/lib/actions/users'
import SmmCalendarView from './SmmCalendarView'

interface Props {
  searchParams: Promise<{ client?: string }>
}

// Глобальный SMM-календарь (следующий этап после 2B, docs/business/SMM.md,
// «Views») — агрегирует уже существующие Publication/ScheduleEvent/
// дедлайны (getSmmCalendarEvents, actions/smm.ts), ничего своего не хранит.
export default async function SmmCalendarPage({ searchParams }: Props) {
  const { client } = await searchParams
  const [projectsResult, editorsResult, staffResult] = await Promise.all([
    getSmmProjects(), getAllEditorProfiles(), getStaffUsers(),
  ])

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">SMM · Календарь</h1>
        <p className="text-zinc-400 text-sm mt-1">Публикации, съёмки и производственные дедлайны всех активных SMM-клиентов</p>
      </div>
      <SmmCalendarView projects={projectsResult.data} initialClientFilter={client ?? null} editors={editorsResult.data} staff={staffResult.data} />
    </div>
  )
}
