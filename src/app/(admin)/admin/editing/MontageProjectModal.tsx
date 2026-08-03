'use client'

import { useMemo, useRef, useState } from 'react'
import { Search, AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  createMontageProject, updateMontageProject,
  type MontageProjectDTO, type MontageProjectInput,
} from '@/lib/actions/montage'
import type { OrderDTO } from '@/lib/actions/orders'
import { getClients } from '@/lib/actions/clients'
import { montageFormValuesToInput } from '@/lib/montage-model'
import MontageProjectFields, { type MontageProjectFieldsHandle } from '@/components/montage/MontageProjectFields'

// Те же геометрия/классы полей, что в OrderFormModal.tsx — единый визуальный
// язык форм-карточек платформы (h-10, zinc-800 фон, зелёный focus-border).
const FIELD_BASE = 'w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg text-sm outline-none focus:border-[#00c26b] transition-colors'
const INPUT = `${FIELD_BASE} px-3 text-zinc-100 placeholder-zinc-600`

interface Props {
  project: MontageProjectDTO | null
  orders: OrderDTO[]
  // Нужен только чтобы предупредить о дубле при привязке НОВОГО проекта к
  // заказу, у которого уже есть проект(ы) — ТЗ п.18: "предупредить и не
  // создавать дубль без явного подтверждения".
  existingProjects: MontageProjectDTO[]
  // Карточка открыта кликом по предупреждению материалов в таблице — при
  // монтаже прокручиваем к разделу "Материалы" и ставим focus на первое
  // отсутствующее поле (ТЗ п.7). Обычное открытие карточки этот проп не задаёт.
  focusMaterialsOnOpen?: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export default function MontageProjectModal({ project, orders, existingProjects, focusMaterialsOnOpen, onOpenChange, onSaved }: Props) {
  const isEdit = !!project
  const fieldsRef = useRef<MontageProjectFieldsHandle>(null)

  // ---- Шаг 1 (только при создании): привязать к заказу или самостоятельный (ТЗ п.18) ----
  const [linkMode, setLinkMode] = useState<'order' | 'standalone' | null>(isEdit ? (project!.orderId ? 'order' : 'standalone') : null)
  const [orderSearch, setOrderSearch] = useState('')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(project?.orderId ?? null)
  const [confirmDuplicateOrder, setConfirmDuplicateOrder] = useState(false)

  const selectedOrder = useMemo(() => orders.find(o => o.id === selectedOrderId) ?? null, [orders, selectedOrderId])
  const orderMatches = useMemo(() => {
    if (!orderSearch.trim()) return orders.slice(0, 20)
    const q = orderSearch.trim().toLowerCase()
    return orders.filter(o => [o.title, o.clientName, o.companyName].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 20)
  }, [orders, orderSearch])

  // ---- Клиент для самостоятельного проекта (ТЗ п.18: "Самостоятельный
  // проект" всё равно требует привязки к реальному клиенту — не создаём
  // фиктивный заказ, но и не оставляем проект вовсе без клиента). ----
  const [clientSearch, setClientSearch] = useState('')
  const [clientMatches, setClientMatches] = useState<{ id: string; name: string; companyName: string | null }[]>([])
  const [selectedClientId, setSelectedClientId] = useState<string | null>(isEdit && !project!.orderId ? project!.clientId : null)
  const [selectedClientLabel, setSelectedClientLabel] = useState<string | null>(isEdit && !project!.orderId ? project!.clientName : null)

  async function searchClients(q: string) {
    setClientSearch(q)
    if (!q.trim()) { setClientMatches([]); return }
    const res = await getClients({ search: q.trim() })
    if (res.ok) setClientMatches(res.data.slice(0, 20).map(c => ({ id: c.id, name: c.name, companyName: c.companyName })))
  }

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const duplicateOrderProjects = !isEdit && selectedOrderId
    ? existingProjects.filter(p => p.orderId === selectedOrderId)
    : []

  async function handleSave() {
    const values = fieldsRef.current!.getValues()

    if (!isEdit && linkMode === 'order' && !selectedOrderId) {
      setError('Выберите заказ для привязки')
      return
    }
    if (!isEdit && linkMode === 'standalone' && !values.title.trim()) {
      setError('Укажите название самостоятельного проекта')
      return
    }
    if (!isEdit && linkMode === 'standalone' && !selectedClientId) {
      setError('Выберите клиента для самостоятельного проекта')
      return
    }
    if (!isEdit && duplicateOrderProjects.length > 0 && !confirmDuplicateOrder) {
      setError('Подтвердите создание ещё одного проекта для этого заказа')
      return
    }

    const input: MontageProjectInput = {
      orderId: isEdit ? undefined : (linkMode === 'order' ? selectedOrderId : null),
      // При редактировании самостоятельного проекта clientId можно менять
      // (единственный способ довязать клиента к строкам исторического
      // импорта, помеченным "!" — см. блок выбора клиента выше). Для
      // проектов, привязанных к заказу (linkMode === 'order'), clientId не
      // трогаем — источник правды там order.clientId, а не это поле.
      clientId: linkMode === 'standalone' ? selectedClientId : undefined,
      ...montageFormValuesToInput(values),
      confirmDuplicateForOrder: confirmDuplicateOrder,
    }

    setSaving(true)
    setError(null)
    const result = isEdit ? await updateMontageProject(project!.id, input) : await createMontageProject(input)
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    onSaved()
  }

  const title2 = isEdit ? (project!.title ?? 'Проект монтажа') : 'Новый проект монтажа'
  const showForm = isEdit || (linkMode === 'standalone' && selectedClientId) || (linkMode === 'order' && selectedOrder)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-xl sm:max-w-[662px] max-h-[88vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800 flex-shrink-0 pr-8">
          <div className="flex items-center gap-2 flex-wrap">
            <DialogTitle className="text-white text-lg font-semibold">{title2}</DialogTitle>
            {isEdit && project!.isArchived && (
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full">В архиве</span>
            )}
            {isEdit && !project!.isArchived && project!.status === 'CANCELLED' && (
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-red-900/60 text-red-300 px-2 py-0.5 rounded-full">Отменён</span>
            )}
            {isEdit && !project!.isArchived && project!.isPaused && (
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-900/60 text-amber-300 px-2 py-0.5 rounded-full">Приостановлен</span>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!isEdit && linkMode === null && (
            <div className="space-y-3">
              <p className="text-zinc-400 text-sm">Как создать проект?</p>
              <button type="button" onClick={() => setLinkMode('order')} className="w-full text-left bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-4 py-3 transition-colors">
                <p className="text-zinc-100 text-sm font-medium">Привязать к существующему заказу</p>
                <p className="text-zinc-500 text-xs mt-0.5">Клиент, дата и исходники подтянутся из заказа</p>
              </button>
              <button type="button" onClick={() => setLinkMode('standalone')} className="w-full text-left bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-4 py-3 transition-colors">
                <p className="text-zinc-100 text-sm font-medium">Самостоятельный проект</p>
                <p className="text-zinc-500 text-xs mt-0.5">Монтаж, не связанный со съёмкой студии</p>
              </button>
            </div>
          )}

          {!isEdit && linkMode === 'order' && !selectedOrderId && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input value={orderSearch} onChange={e => setOrderSearch(e.target.value)} placeholder="Поиск заказа по клиенту, названию..." className={`${INPUT} pl-9`} />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {orderMatches.map(o => (
                  <button key={o.id} type="button" onClick={() => setSelectedOrderId(o.id)} className="w-full text-left bg-zinc-800/60 hover:bg-zinc-800 rounded-lg px-3 py-2 transition-colors">
                    <p className="text-zinc-200 text-sm truncate">{o.title ?? o.clientName ?? 'Без названия'}</p>
                    <p className="text-zinc-500 text-xs truncate">{o.clientName}{o.companyName ? ` · ${o.companyName}` : ''}</p>
                  </button>
                ))}
                {orderMatches.length === 0 && <p className="text-zinc-500 text-sm text-center py-6">Заказы не найдены</p>}
              </div>
              <button type="button" onClick={() => setLinkMode(null)} className="text-zinc-500 hover:text-zinc-300 text-xs">← Назад</button>
            </div>
          )}

          {!isEdit && linkMode === 'order' && selectedOrder && (
            <div className="mb-4 flex items-center justify-between gap-3 bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-zinc-200 text-sm truncate">{selectedOrder.title ?? selectedOrder.clientName}</p>
                <p className="text-zinc-500 text-xs truncate">{selectedOrder.clientName}</p>
              </div>
              <button type="button" onClick={() => setSelectedOrderId(null)} className="text-zinc-500 hover:text-zinc-300 text-xs flex-shrink-0">Изменить</button>
            </div>
          )}

          {linkMode === 'standalone' && !selectedClientId && (
            <div className="space-y-3 mb-4">
              {isEdit && (
                <p className="text-amber-300 text-xs flex items-center gap-1.5 bg-amber-950/20 border border-amber-600/40 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  Клиент не привязан{project?.clientName ? ` — в исходных данных: "${project.clientName}"` : ''}. Найдите и выберите клиента ниже.
                </p>
              )}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input value={clientSearch} onChange={e => searchClients(e.target.value)} placeholder="Поиск клиента по имени, компании, телефону..." className={`${INPUT} pl-9`} />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {clientMatches.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setSelectedClientId(c.id); setSelectedClientLabel(c.name) }}
                    className="w-full text-left bg-zinc-800/60 hover:bg-zinc-800 rounded-lg px-3 py-2 transition-colors"
                  >
                    <p className="text-zinc-200 text-sm truncate">{c.name}</p>
                    {c.companyName && <p className="text-zinc-500 text-xs truncate">{c.companyName}</p>}
                  </button>
                ))}
                {clientSearch.trim() && clientMatches.length === 0 && <p className="text-zinc-500 text-sm text-center py-6">Клиенты не найдены</p>}
                {!clientSearch.trim() && <p className="text-zinc-500 text-xs text-center py-4">Начните вводить имя или компанию клиента</p>}
              </div>
              {!isEdit && (
                <button type="button" onClick={() => setLinkMode(null)} className="text-zinc-500 hover:text-zinc-300 text-xs">← Назад</button>
              )}
            </div>
          )}

          {linkMode === 'standalone' && selectedClientId && (
            <div className="mb-4 flex items-center justify-between gap-3 bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5">
              <p className="text-zinc-200 text-sm truncate">{selectedClientLabel}</p>
              <button type="button" onClick={() => { setSelectedClientId(null); setSelectedClientLabel(null) }} className="text-zinc-500 hover:text-zinc-300 text-xs flex-shrink-0">Изменить</button>
            </div>
          )}

          {!isEdit && duplicateOrderProjects.length > 0 && (
            <div className="mb-4 bg-amber-950/20 border border-amber-600/40 rounded-lg px-3 py-2.5 space-y-2">
              <p className="text-amber-300 text-xs flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                У этого заказа уже есть {duplicateOrderProjects.length === 1 ? 'проект монтажа' : `проекты монтажа (${duplicateOrderProjects.length})`}: {duplicateOrderProjects.map(p => p.title ?? 'без названия').join(', ')}
              </p>
              <label className="flex items-center gap-1.5 text-xs text-amber-200 cursor-pointer select-none">
                <input type="checkbox" checked={confirmDuplicateOrder} onChange={e => setConfirmDuplicateOrder(e.target.checked)} className="accent-amber-500" />
                Да, создать ещё один проект для этого заказа
              </label>
            </div>
          )}

          {showForm && (
            <>
              {error && <p className="text-red-400 text-xs bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2 mb-3">{error}</p>}
              <MontageProjectFields
                ref={fieldsRef}
                project={project}
                focusMaterialsOnOpen={focusMaterialsOnOpen}
                onProjectChanged={() => onSaved()}
              />
            </>
          )}
        </div>

        {showForm && (
          <div className="px-6 py-4 border-t border-zinc-800 flex-shrink-0 flex items-center gap-3">
            <button type="button" onClick={handleSave} disabled={saving} className="flex-1 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors">
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
            <button type="button" onClick={() => onOpenChange(false)} className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">
              Отмена
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
