'use client'

import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { getAllEditorProfiles, type EditorProfileListItemDTO } from '@/lib/actions/editors'
import { pluralizeProjectsCount } from '@/lib/montage-model'

const INPUT = 'w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg text-sm px-3 pl-8 text-zinc-100 placeholder-zinc-600 outline-none focus:border-[#00c26b] transition-colors'
const LABEL = 'block text-zinc-400 text-xs'

interface Props {
  value: string | null
  valueLabel: string | null
  onSelect: (editor: EditorProfileListItemDTO | null) => void
}

// Комбобокс "Ответственный монтажёр" — переиспользует существующий приём
// input+отфильтрованный список кнопок (тот же паттерн, что поиск заказа/
// клиента в MontageProjectModal.tsx), а не изобретает новый UI-компонент.
// Данные — getAllEditorProfiles() (уже один join-запрос с summary.totalProjects,
// используется и в разделе "Монтажёры" — не заводим вторую агрегацию).
// По умолчанию (пустой поиск) — только активные, по убыванию totalProjects;
// при непустом поиске — все, включая архивных (помечены отдельно).
export default function EditorAssignField({ value, valueLabel, onSelect }: Props) {
  const [editors, setEditors] = useState<EditorProfileListItemDTO[] | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAllEditorProfiles().then(res => {
      if (!cancelled && res.ok) setEditors(res.data)
    })
    return () => { cancelled = true }
  }, [])

  const trimmedQuery = query.trim().toLowerCase()
  const candidates = (editors ?? []).filter(ed => {
    if (!trimmedQuery) return ed.active
    return ed.displayName.toLowerCase().includes(trimmedQuery)
  })
  const sorted = [...candidates].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    if (a.summary.totalProjects !== b.summary.totalProjects) return b.summary.totalProjects - a.summary.totalProjects
    return a.displayName.localeCompare(b.displayName, 'ru')
  }).slice(0, 20)

  function handlePick(editor: EditorProfileListItemDTO | null) {
    onSelect(editor)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="relative">
      <label className={LABEL}>Ответственный монтажёр</label>
      <div className="relative mt-1.5">
        <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          className={INPUT}
          placeholder={valueLabel ?? 'Не назначен — начните вводить имя'}
          value={open ? query : ''}
          onFocus={() => setOpen(true)}
          onChange={e => setQuery(e.target.value)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      </div>
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {value && (
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => handlePick(null)}
              className="w-full text-left px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-700 transition-colors border-b border-zinc-700/60">
              Не назначен
            </button>
          )}
          {editors === null ? (
            <p className="px-3 py-2 text-xs text-zinc-500">Загрузка...</p>
          ) : sorted.length === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-500">Никого не найдено</p>
          ) : (
            sorted.map(ed => (
              <button key={ed.id} type="button" onMouseDown={e => e.preventDefault()} onClick={() => handlePick(ed)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-zinc-700 transition-colors">
                <span className={`text-xs ${ed.id === value ? 'text-[#00c26b] font-medium' : 'text-zinc-200'}`}>
                  {ed.displayName}
                  {!ed.active && <span className="text-zinc-500"> · архив</span>}
                </span>
                <span className="text-zinc-500 text-[11px] flex-shrink-0">{pluralizeProjectsCount(ed.summary.totalProjects)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
