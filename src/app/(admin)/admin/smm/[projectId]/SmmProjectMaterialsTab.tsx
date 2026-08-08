'use client'

import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, ExternalLink, Search } from 'lucide-react'
import { addSmmMaterialLink, updateSmmMaterialLink, deleteSmmMaterialLink, type SmmMaterialLinkDTO, type SmmMaterialLinkInput, type SmmContentItemDTO } from '@/lib/actions/smm'
import { SMM_MATERIAL_CATEGORY_LABELS } from '@/lib/smm-model'
import type { SmmMaterialCategory } from '@prisma/client'

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'w-full h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'

const EMPTY_FORM: SmmMaterialLinkInput = { category: 'SOURCE', title: '', url: '', description: '' }

interface Props {
  smmProjectId: string
  materialLinks: SmmMaterialLinkDTO[]
  setMaterialLinks: (updater: (prev: SmmMaterialLinkDTO[]) => SmmMaterialLinkDTO[]) => void
  contentItems: SmmContentItemDTO[]
}

export default function SmmProjectMaterialsTab({ smmProjectId, materialLinks, setMaterialLinks }: Props) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<SmmMaterialLinkInput>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | SmmMaterialCategory>('ALL')

  const filtered = useMemo(() => materialLinks.filter(l => {
    if (categoryFilter !== 'ALL' && l.category !== categoryFilter) return false
    if (search.trim() && !l.title.toLowerCase().includes(search.trim().toLowerCase())) return false
    return true
  }), [materialLinks, categoryFilter, search])

  function startEdit(l: SmmMaterialLinkDTO) {
    setEditingId(l.id)
    setForm({ category: l.category, title: l.title, url: l.url, description: l.description ?? '' })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    if (editingId === 'new') {
      const result = await addSmmMaterialLink(smmProjectId, form)
      setSaving(false)
      if (!result.ok) { setError(result.error); return }
      setMaterialLinks(prev => [result.data, ...prev])
    } else if (editingId) {
      const result = await updateSmmMaterialLink(editingId, form)
      setSaving(false)
      if (!result.ok) { setError(result.error); return }
      setMaterialLinks(prev => prev.map(l => l.id === editingId ? result.data : l))
    }
    setEditingId(null)
  }

  async function handleDelete(id: string) {
    const result = await deleteSmmMaterialLink(id)
    if (result.ok) setMaterialLinks(prev => prev.filter(l => l.id !== id))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input className={`${INPUT} pl-9`} placeholder="Поиск по названию..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className={SELECT} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value as 'ALL' | SmmMaterialCategory)}>
            <option value="ALL">Все категории</option>
            {(Object.keys(SMM_MATERIAL_CATEGORY_LABELS) as SmmMaterialCategory[]).map(c => <option key={c} value={c}>{SMM_MATERIAL_CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
        <button type="button" onClick={() => { setEditingId('new'); setForm(EMPTY_FORM) }} className="flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors">
          <Plus className="w-4 h-4" />
          Добавить материал
        </button>
      </div>

      {editingId && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Категория</label>
              <select className={SELECT} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as SmmMaterialCategory }))}>
                {(Object.keys(SMM_MATERIAL_CATEGORY_LABELS) as SmmMaterialCategory[]).map(c => <option key={c} value={c}>{SMM_MATERIAL_CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Название</label>
              <input className={INPUT} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-zinc-400 text-xs mb-1.5">Ссылка</label>
            <input className={INPUT} placeholder="https://disk.yandex.ru/..." value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
          </div>
          <div>
            <label className="block text-zinc-400 text-xs mb-1.5">Комментарий</label>
            <input className={INPUT} value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={handleSave} disabled={saving} className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
            <button type="button" onClick={() => setEditingId(null)} className="text-zinc-400 hover:text-zinc-200 text-sm px-4 py-2 transition-colors">Отмена</button>
          </div>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60 overflow-hidden">
        {filtered.map(l => (
          <div key={l.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="text-zinc-100 text-sm">{l.title} <span className="text-zinc-500 text-xs">({SMM_MATERIAL_CATEGORY_LABELS[l.category]})</span></p>
              {l.description && <p className="text-zinc-500 text-xs mt-0.5">{l.description}</p>}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-zinc-200 transition-colors"><ExternalLink className="w-3.5 h-3.5" /></a>
              <button type="button" onClick={() => startEdit(l)} className="text-zinc-500 hover:text-zinc-300 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => handleDelete(l.id)} className="text-zinc-500 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-zinc-500 text-sm px-5 py-6">Материалов пока нет</p>}
      </div>
    </div>
  )
}
