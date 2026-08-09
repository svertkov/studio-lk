import { getSmmProjects } from '@/lib/actions/smm'
import { getAllEditorProfiles } from '@/lib/actions/editors'
import { getStaffUsers } from '@/lib/actions/users'
import SmmAnalyticsView from './SmmAnalyticsView'

interface Props {
  searchParams: Promise<{ client?: string }>
}

// Первый полноценный табличный вид аналитики (следующий этап после 2B,
// docs/business/SMM.md, «Views») — над Publication+SmmPublicationMetric,
// НЕ новый analytics-backend (getSmmAnalyticsRows, actions/smm.ts).
export default async function SmmAnalyticsPage({ searchParams }: Props) {
  const { client } = await searchParams
  const [projectsResult, editorsResult, staffResult] = await Promise.all([
    getSmmProjects(), getAllEditorProfiles(), getStaffUsers(),
  ])

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">SMM · Аналитика</h1>
        <p className="text-zinc-400 text-sm mt-1">Показатели публикаций всех SMM-клиентов — снимки метрик, не заменяют клиентские отчёты полностью</p>
      </div>
      <SmmAnalyticsView projects={projectsResult.data} initialClientFilter={client ?? null} editors={editorsResult.data} staff={staffResult.data} />
    </div>
  )
}
