import { getAllMontageProjects, getMontageDashboardStats } from '@/lib/actions/montage'
import { getAllEditorProfiles } from '@/lib/actions/editors'
import { getAllOrders } from '@/lib/actions/orders'
import EditingView from './EditingView'

export default async function EditingPage() {
  const [projectsResult, statsResult, editorsResult, ordersResult] = await Promise.all([
    getAllMontageProjects(),
    getMontageDashboardStats(),
    getAllEditorProfiles(),
    getAllOrders(),
  ])

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Монтаж</h1>
        <p className="text-zinc-400 text-sm mt-1">Проекты монтажа, монтажёры и финансы постпродакшна</p>
      </div>

      <EditingView
        initialProjects={projectsResult.data}
        initialStats={statsResult.ok ? statsResult.data : null}
        initialEditors={editorsResult.data}
        orders={ordersResult.data}
      />
    </div>
  )
}
