import { getSmmProductionItems, getSmmProjects, getSmmContentItemDetail } from '@/lib/actions/smm'
import { getAllEditorProfiles } from '@/lib/actions/editors'
import { getStaffUsers } from '@/lib/actions/users'
import ProductionView from './ProductionView'

interface Props {
  searchParams: Promise<{ openContentId?: string }>
}

// Отдельный route, НЕ вложенный в конкретный [projectId] (ТЗ 2B, п.3) —
// глобальный операционный экран поверх контента всех активных SmmProject.
export default async function SmmProductionPage({ searchParams }: Props) {
  const { openContentId } = await searchParams
  const [itemsResult, projectsResult, editorsResult, staffResult] = await Promise.all([
    getSmmProductionItems(),
    getSmmProjects(),
    getAllEditorProfiles(),
    getStaffUsers(),
  ])

  // Deep-link (?openContentId=...) резолвится здесь, на сервере — та же
  // архитектура, что и ?openOrderId= в admin/crm/page.tsx: карточка
  // открывается сразу при первой отрисовке, без клиентского useEffect-фетча.
  let initialDetail = null
  if (openContentId) {
    const detailResult = await getSmmContentItemDetail(openContentId)
    if (detailResult.ok) initialDetail = detailResult.data
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">SMM · Производство</h1>
        <p className="text-zinc-400 text-sm mt-1">Весь контент активных SMM-проектов — единый рабочий экран вместо клиентских Excel-таблиц</p>
      </div>

      <ProductionView
        initialItems={itemsResult.data}
        projects={projectsResult.data}
        editors={editorsResult.data}
        staff={staffResult.data}
        initialDetail={initialDetail}
      />
    </div>
  )
}
