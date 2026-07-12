'use client'

import { useCallback, useState } from 'react'
import { LayoutDashboard, ListChecks, Users, Plus } from 'lucide-react'
import type { MontageProjectDTO } from '@/lib/actions/montage'
import { getAllMontageProjects, getMontageDashboardStats } from '@/lib/actions/montage'
import { getAllEditorProfiles, type EditorProfileListItemDTO } from '@/lib/actions/editors'
import type { MontageDashboardStats } from '@/lib/montage-model'
import type { OrderDTO } from '@/lib/actions/orders'
import MontageOverview from './MontageOverview'
import MontageProjectsTable, { type MontageProjectsFilterPreset } from './MontageProjectsTable'
import MontageProjectModal from './MontageProjectModal'
import EditorsPanel from './EditorsPanel'
import EditorProfileModal from './EditorProfileModal'

type Tab = 'overview' | 'projects' | 'editors'

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Обзор', icon: LayoutDashboard },
  { key: 'projects', label: 'Проекты', icon: ListChecks },
  { key: 'editors', label: 'Монтажёры', icon: Users },
]

interface Props {
  initialProjects: MontageProjectDTO[]
  initialStats: MontageDashboardStats | null
  initialEditors: EditorProfileListItemDTO[]
  orders: OrderDTO[]
}

// Единая точка правды раздела "Монтаж" на клиенте: держит projects/stats/editors
// и одну функцию refresh(), которую вызывает любая мутация (создание/
// редактирование проекта, назначение монтажёра, изменение статуса) — вместо
// того чтобы каждая вложенная форма сама решала, что перезагрузить.
export default function EditingView({ initialProjects, initialStats, initialEditors, orders }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [projects, setProjects] = useState(initialProjects)
  const [stats, setStats] = useState(initialStats)
  const [editors, setEditors] = useState(initialEditors)
  const [projectsFilterPreset, setProjectsFilterPreset] = useState<MontageProjectsFilterPreset | null>(null)
  // Растёт при каждом переходе с KPI-карточки дашборда — используется как
  // key таблицы ниже, чтобы применить новый пресет фильтров пересозданием
  // компонента (lazy useState), а не синхронизирующим useEffect с setState.
  const [projectsTableInstance, setProjectsTableInstance] = useState(0)

  const [openProject, setOpenProject] = useState<MontageProjectDTO | null>(null)
  const [creatingProject, setCreatingProject] = useState(false)
  const [selectedEditorId, setSelectedEditorId] = useState<string | null>(null)
  const [creatingEditor, setCreatingEditor] = useState(false)

  const refresh = useCallback(async () => {
    const [projectsResult, statsResult, editorsResult] = await Promise.all([
      getAllMontageProjects(),
      getMontageDashboardStats(),
      getAllEditorProfiles(),
    ])
    setProjects(projectsResult.data)
    if (statsResult.ok) setStats(statsResult.data)
    setEditors(editorsResult.data)
  }, [])

  function goToProjectsWithFilter(preset: MontageProjectsFilterPreset) {
    setProjectsFilterPreset(preset)
    setProjectsTableInstance(n => n + 1)
    setTab('projects')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
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
        <button
          type="button"
          onClick={() => setCreatingProject(true)}
          className="flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] text-white font-semibold text-sm px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Добавить проект монтажа
        </button>
      </div>

      {tab === 'overview' && (
        <MontageOverview stats={stats} projects={projects} onGoToProjects={goToProjectsWithFilter} />
      )}

      {tab === 'projects' && (
        <MontageProjectsTable
          key={projectsTableInstance}
          projects={projects}
          editors={editors}
          initialFilterPreset={projectsFilterPreset}
          onOpenProject={setOpenProject}
        />
      )}

      {tab === 'editors' && (
        <EditorsPanel editors={editors} onOpenEditor={setSelectedEditorId} onCreateEditor={() => setCreatingEditor(true)} />
      )}

      {(openProject || creatingProject) && (
        <MontageProjectModal
          project={openProject}
          orders={orders}
          editors={editors}
          existingProjects={projects}
          onOpenChange={open => { if (!open) { setOpenProject(null); setCreatingProject(false) } }}
          onSaved={() => { setOpenProject(null); setCreatingProject(false); refresh() }}
        />
      )}

      {(selectedEditorId || creatingEditor) && (
        <EditorProfileModal
          editorId={selectedEditorId}
          onOpenChange={open => { if (!open) { setSelectedEditorId(null); setCreatingEditor(false) } }}
          onSaved={() => { setCreatingEditor(false); refresh() }}
          onOpenProject={p => { setSelectedEditorId(null); setOpenProject(p) }}
        />
      )}
    </div>
  )
}
