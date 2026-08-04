'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  getMontageProjectsForOrder, updateMontageProject, ensureMontageProjectForOrder, type MontageProjectDTO,
} from '@/lib/actions/montage'
import { MONTAGE_STATUS_LABELS, isMontageFormEmpty } from '@/lib/montage-model'
import MontageProjectFields, { type MontageProjectFieldsHandle } from './MontageProjectFields'

// Встроенный редактор монтажа внутри канонической карточки заказа
// (EventCardModal.tsx/OrderFormModal.tsx, см. ORDERS.md, «Карточка заказа»).
// Переиспользует тот же MontageProjectFields.tsx, что и отдельная карточка
// монтажа (MontageProjectModal.tsx) — здесь только: подгрузка проекта по
// orderId, компактный индикатор состояния, вторичная кнопка "Открыть карточку
// монтажа" и commitMontage() — единая точка "обогатить проект текущими
// значениями формы после сохранения заказа", вызывается родителем из его
// handleSave (см. MONTAGE.md, «Встраивание в карточку заказа»).

export interface EmbeddedMontageSectionHandle {
  // Родитель вызывает это ПОСЛЕ того, как заказ успешно сохранён и известен
  // его orderId (только что созданный или уже существовавший). Сама находит
  // актуальный проект (созданный идемпотентным ensureMontageProjectForOrder
  // на сервере при сохранении заказа, либо уже существовавший) и обновляет
  // его текущими значениями формы — не создаёт проект самостоятельно, только
  // обогащает уже гарантированно существующий (см. ensureMontageProjectForOrder,
  // actions/montage.ts).
  commitMontage: (orderId: string) => Promise<{ ok: true } | { ok: false; error: string }>
  // Для подтверждения при выключении "Монтаж требуется" ДО первого сохранения
  // (ТЗ, Случай 1) — есть ли что терять. Пока проект уже существует (Случай 2)
  // используется отдельный MontageDisableChoiceDialog, не эта функция.
  hasDraftContent: () => boolean
}

interface Props {
  // null — заказ ещё не сохранён (нет orderId вовсе, "чистый" черновик).
  orderId: string | null
  // Активные (не CANCELLED) проекты заказа — родителю нужно для
  // MontageDisableChoiceDialog при отключении "Монтаж требуется" (тот же
  // формат, что раньше отдавал OrderFinanceBlock.onMontageProjectsLoaded).
  onProjectsLoaded?: (projects: MontageProjectDTO[]) => void
}

const EmbeddedMontageSection = forwardRef<EmbeddedMontageSectionHandle, Props>(function EmbeddedMontageSection(
  { orderId, onProjectsLoaded }, ref,
) {
  const [projects, setProjects] = useState<MontageProjectDTO[] | null>(null)
  const [openFullCard, setOpenFullCard] = useState(false)
  const [FullCardComp, setFullCardComp] = useState<typeof import('../../app/(admin)/admin/editing/MontageProjectModal').default | null>(null)
  const fieldsRef = useRef<MontageProjectFieldsHandle>(null)

  useEffect(() => {
    let cancelled = false
    if (!orderId) {
      // setState отложен через setTimeout(…, 0) — react-hooks/set-state-in-effect
      // не разрешает синхронный setState в теле эффекта (см. тот же приём в
      // OrderFinanceBlock.tsx).
      const timer = setTimeout(() => { setProjects([]); onProjectsLoaded?.([]) }, 0)
      return () => clearTimeout(timer)
    }
    getMontageProjectsForOrder(orderId).then(res => {
      if (cancelled) return
      setProjects(res.data)
      onProjectsLoaded?.(res.data.filter(p => p.status !== 'CANCELLED'))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  const activeProject = projects?.find(p => p.status !== 'CANCELLED') ?? null

  useImperativeHandle(ref, () => ({
    async commitMontage(committedOrderId: string) {
      const changedInput = fieldsRef.current?.getChangedInput()
      if (!changedInput) return { ok: true }
      const projectsRes = await getMontageProjectsForOrder(committedOrderId)
      let active = projectsRes.data.find(p => p.status !== 'CANCELLED')
      if (!active) {
        // Восстановление после частичного сбоя (аудит 2026-08-04): обычно
        // ensureMontageProjectForOrder уже создал минимальный проект на
        // сервере ВНУТРИ сохранения заказа (см. orders.ts/schedule.ts) к
        // этому моменту. Но если та попытка сама по себе упала (сеть, БД) —
        // заказ мог остаться сохранённым с editingRequired=true и БЕЗ
        // проекта, а сервер САМ это не перепроверит на следующем сохранении
        // (условие там — "editingRequired только что стало true", не
        // "true, но проекта так и нет"). Поэтому здесь — самостоятельный
        // повторный вызов той же идемпотентной функции перед тем, как сдаться:
        // безопасно позвать сколько угодно раз, дубль не создаст (advisory
        // lock + count-внутри-транзакции, см. actions/montage.ts).
        await ensureMontageProjectForOrder(committedOrderId)
        const retryRes = await getMontageProjectsForOrder(committedOrderId)
        active = retryRes.data.find(p => p.status !== 'CANCELLED')
      }
      if (!active) {
        // Всё ещё нет — заказ не найден или что-то более фундаментально не
        // так (не сетевой сбой, который повторный вызов уже исправил бы).
        // Явная ошибка, а не тихий пропуск (ТЗ: "ошибка создания проекта не
        // должна выглядеть как успешное сохранение").
        return { ok: false, error: 'Проект монтажа не найден после сохранения заказа' }
      }
      // getChangedInput() (не getValues()+montageFormValuesToInput()) — форма
      // могла смонтироваться раньше, чем ensureMontageProjectForOrder создал
      // проект в фоне (например через автосохранение карточки заказа, см.
      // diffMontageFormValues в montage-model.ts). Полный набор значений
      // затёр бы серверные значения по умолчанию (sourceReceivedAt,
      // автоугаданный title и т.п.) пустыми полями, которые админ не трогал.
      const result = await updateMontageProject(active.id, changedInput)
      if (!result.ok) return { ok: false, error: result.error }
      setProjects(prev => (prev ?? []).some(p => p.id === result.data.id)
        ? (prev ?? []).map(p => (p.id === result.data.id ? result.data : p))
        : [...(prev ?? []), result.data])
      return { ok: true }
    },
    hasDraftContent() {
      if (activeProject) return false
      const values = fieldsRef.current?.getValues()
      return values ? !isMontageFormEmpty(values) : false
    },
  }), [activeProject])

  async function openFullCardModal() {
    if (!FullCardComp) {
      const mod = await import('../../app/(admin)/admin/editing/MontageProjectModal')
      setFullCardComp(() => mod.default)
    }
    setOpenFullCard(true)
  }

  if (projects === null) {
    return <p className="text-zinc-500 text-xs">Загрузка данных монтажа...</p>
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <p className="text-zinc-400 text-xs">
          {activeProject
            ? `Проект создан · ${MONTAGE_STATUS_LABELS[activeProject.status]}${activeProject.isPaused ? ' · приостановлен' : ''}`
            : 'Новый проект будет создан после сохранения'}
        </p>
        {activeProject && (
          <button type="button" onClick={openFullCardModal} className="text-xs text-zinc-400 hover:text-white underline">
            Открыть карточку монтажа
          </button>
        )}
      </div>
      <MontageProjectFields ref={fieldsRef} project={activeProject} showOrderLink={false} onProjectChanged={p => {
        setProjects(prev => (prev ?? []).map(x => (x.id === p.id ? p : x)))
      }} />

      {openFullCard && FullCardComp && activeProject && (
        <FullCardComp
          project={activeProject}
          orders={[]}
          existingProjects={[]}
          onOpenChange={open => { if (!open) setOpenFullCard(false) }}
          onSaved={() => {
            setOpenFullCard(false)
            if (orderId) {
              getMontageProjectsForOrder(orderId).then(res => {
                setProjects(res.data)
                onProjectsLoaded?.(res.data.filter(p => p.status !== 'CANCELLED'))
              })
            }
          }}
        />
      )}
    </>
  )
})

export default EmbeddedMontageSection
