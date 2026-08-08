'use client'

import { useState } from 'react'
import { Plus, Trash2, Pencil } from 'lucide-react'
import { addSmmPackageItem, updateSmmPackageItem, deleteSmmPackageItem, type SmmPackageItemDTO, type SmmPackageItemInput } from '@/lib/actions/smm'
import { SMM_SERVICE_TYPE_LABELS, SMM_PACKAGE_UNIT_LABELS, SMM_PACKAGE_PERIOD_LABELS } from '@/lib/smm-model'
import type { SmmServiceType, SmmPackageUnit, SmmPackagePeriod } from '@prisma/client'

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'w-full h-9 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'

const EMPTY_FORM: SmmPackageItemInput = { serviceType: 'SHORT_VIDEO', customName: '', quantity: null, unit: 'PIECE', period: 'MONTH', description: '', included: true }

interface Props {
  smmProjectId: string
  packageItems: SmmPackageItemDTO[]
  setPackageItems: (updater: (prev: SmmPackageItemDTO[]) => SmmPackageItemDTO[]) => void
}

export default function SmmProjectPackageTab({ smmProjectId, packageItems, setPackageItems }: Props) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<SmmPackageItemInput>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startEdit(item: SmmPackageItemDTO) {
    setEditingId(item.id)
    setForm({ serviceType: item.serviceType, customName: item.customName ?? '', quantity: item.quantity, unit: item.unit, period: item.period, description: item.description ?? '', included: item.included })
  }

  function startNew() {
    setEditingId('new')
    setForm(EMPTY_FORM)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    if (editingId === 'new') {
      const result = await addSmmPackageItem(smmProjectId, form)
      setSaving(false)
      if (!result.ok) { setError(result.error); return }
      setPackageItems(prev => [...prev, result.data])
    } else if (editingId) {
      const result = await updateSmmPackageItem(editingId, form)
      setSaving(false)
      if (!result.ok) { setError(result.error); return }
      setPackageItems(prev => prev.map(p => p.id === editingId ? result.data : p))
    }
    setEditingId(null)
  }

  async function handleDelete(id: string) {
    const result = await deleteSmmPackageItem(id)
    if (result.ok) setPackageItems(prev => prev.filter(p => p.id !== id))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">Пакет услуг</h3>
        <button type="button" onClick={startNew} className="flex items-center gap-1.5 bg-[#00c26b] hover:bg-[#00b360] text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors">
          <Plus className="w-4 h-4" />
          Добавить пункт
        </button>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800/60 overflow-hidden">
        {packageItems.map(item => (
          <div key={item.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="text-zinc-100 text-sm">
                {item.serviceType === 'OTHER' ? (item.customName || 'Другое') : SMM_SERVICE_TYPE_LABELS[item.serviceType]}
                {!item.included && <span className="text-zinc-500 text-xs ml-2">(не входит в пакет)</span>}
              </p>
              <p className="text-zinc-500 text-xs mt-0.5">
                {item.quantity != null ? `${item.quantity} ${SMM_PACKAGE_UNIT_LABELS[item.unit]} ${SMM_PACKAGE_PERIOD_LABELS[item.period]}` : SMM_PACKAGE_PERIOD_LABELS[item.period]}
                {item.description && ` · ${item.description}`}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button type="button" onClick={() => startEdit(item)} className="text-zinc-500 hover:text-zinc-300 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => handleDelete(item.id)} className="text-zinc-500 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
        {packageItems.length === 0 && editingId !== 'new' && (
          <p className="text-zinc-500 text-sm px-5 py-6">Пакет пуст — добавьте первый пункт</p>
        )}
      </div>

      {editingId && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Тип услуги</label>
              <select className={SELECT} value={form.serviceType} onChange={e => setForm(f => ({ ...f, serviceType: e.target.value as SmmServiceType }))}>
                {(Object.keys(SMM_SERVICE_TYPE_LABELS) as SmmServiceType[]).map(t => (
                  <option key={t} value={t}>{SMM_SERVICE_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            {form.serviceType === 'OTHER' && (
              <div>
                <label className="block text-zinc-400 text-xs mb-1.5">Название</label>
                <input className={INPUT} value={form.customName ?? ''} onChange={e => setForm(f => ({ ...f, customName: e.target.value }))} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Количество (пусто — без числа)</label>
              <input className={INPUT} type="number" min="0" value={form.quantity ?? ''} onChange={e => setForm(f => ({ ...f, quantity: e.target.value ? parseFloat(e.target.value) : null }))} />
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Единица</label>
              <select className={SELECT} value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value as SmmPackageUnit }))}>
                {(Object.keys(SMM_PACKAGE_UNIT_LABELS) as SmmPackageUnit[]).map(u => <option key={u} value={u}>{SMM_PACKAGE_UNIT_LABELS[u]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-zinc-400 text-xs mb-1.5">Период</label>
              <select className={SELECT} value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value as SmmPackagePeriod }))}>
                {(Object.keys(SMM_PACKAGE_PERIOD_LABELS) as SmmPackagePeriod[]).map(p => <option key={p} value={p}>{SMM_PACKAGE_PERIOD_LABELS[p]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-zinc-400 text-xs mb-1.5">Комментарий / условия (напр. «3–6 шт/неделю», «скидка 20% на студию»)</label>
            <input className={INPUT} value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
            <input type="checkbox" checked={form.included ?? true} onChange={e => setForm(f => ({ ...f, included: e.target.checked }))} />
            Входит в базовую стоимость пакета
          </label>

          {error && <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={handleSave} disabled={saving} className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
            <button type="button" onClick={() => setEditingId(null)} className="text-zinc-400 hover:text-zinc-200 text-sm px-4 py-2 transition-colors">Отмена</button>
          </div>
        </div>
      )}
    </div>
  )
}
