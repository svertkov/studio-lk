'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { AlertTriangle } from 'lucide-react'
import { getClientSubscriptions, type ClientSubscriptionDTO } from '@/lib/actions/subscriptions'
import {
  isSubscriptionSelectable, getSubscriptionDisplayStatus,
  SUBSCRIPTION_DISPLAY_STATUS_LABELS, SUBSCRIPTION_DISPLAY_STATUS_COLORS,
  SUBSCRIPTION_ARCHIVED_BADGE_LABEL, SUBSCRIPTION_ARCHIVED_BADGE_CLASS,
} from '@/lib/subscription-model'
import SubscriptionActionsMenu from '@/components/subscriptions/SubscriptionActionsMenu'
import type { ScheduleEventSubscriptionInfo } from '@/lib/schedule-model'

export type SubscriptionPaymentValue =
  | { paymentType: 'ONE_TIME' }
  | { paymentType: 'EXISTING'; subscriptionId: string; usedHours: number }
  | { paymentType: 'NEW'; packageHours: number; paidAmount: number | null; purchasedAt: string; usedHours: number }

export interface SubscriptionPaymentHandle {
  getValue: () => SubscriptionPaymentValue
}

interface Props {
  clientId: string
  eventDurationHours: number
  initialUsage: ScheduleEventSubscriptionInfo | null
  onModeChange: (mode: 'ONE_TIME' | 'SUBSCRIPTION') => void
  onValidityChange: (valid: boolean) => void
}

const PACKAGE_OPTIONS = [6, 10, 20]
const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'
const LABEL = 'block text-zinc-400 text-xs mb-1.5'

function defaultUsedHours(hours: number): string {
  const rounded = Math.round(hours * 4) / 4
  return (rounded > 0 ? rounded : 1).toString()
}

function pillClass(active: boolean) {
  return `px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
    active ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
  }`
}

const SubscriptionPaymentBlock = forwardRef<SubscriptionPaymentHandle, Props>(function SubscriptionPaymentBlock(
  { clientId, eventDurationHours, initialUsage, onModeChange, onValidityChange },
  ref,
) {
  const [mode, setMode] = useState<'ONE_TIME' | 'SUBSCRIPTION'>(initialUsage ? 'SUBSCRIPTION' : 'ONE_TIME')
  const [subscriptions, setSubscriptions] = useState<ClientSubscriptionDTO[] | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [showOld, setShowOld] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(initialUsage?.subscriptionId ?? null)
  const [usedHours, setUsedHours] = useState(
    initialUsage ? initialUsage.usedHours.toString() : defaultUsedHours(eventDurationHours),
  )
  const [newPackageHours, setNewPackageHours] = useState('6')
  const [newPaidAmount, setNewPaidAmount] = useState('')
  const [newPurchasedAt, setNewPurchasedAt] = useState(format(new Date(), 'yyyy-MM-dd'))

  const fetchSubscriptions = useCallback(async () => {
    const res = await getClientSubscriptions(clientId)
    setSubscriptions(res.data)
    return res.data
  }, [clientId])

  useEffect(() => {
    let cancelled = false
    fetchSubscriptions().then(data => {
      if (cancelled) return
      // Если активных абонементов нет, НЕ переключаем форму в "создать новый"
      // автоматически — иначе достаточно нажать "Сохранить", ничего не меняя,
      // чтобы случайно купить клиенту новый абонемент по умолчанию (реальный
      // случай: старый абонемент закончился, форма молча создала лишний новый
      // на 6ч). Пользователь должен сам нажать "Создать абонемент".
      const active = data.filter(isSubscriptionSelectable)
      if (initialUsage && active.some(s => s.id === initialUsage.subscriptionId)) {
        setSelectedId(initialUsage.subscriptionId)
      } else if (active.length > 0) {
        setSelectedId(active[0].id)
      }
      // Иначе (ни исходный абонемент этой записи, ни какой-либо другой не
      // активны) — НЕ трогаем selectedId, оставляем его как есть (изначально
      // это initialUsage?.subscriptionId ?? null). Он не найдётся среди
      // activeSubscriptions ниже — и это специально: именно по этому
      // совпадению (selectedId === initialUsage.subscriptionId, но вне
      // активного списка) эффект валидности ниже понимает "это та же самая,
      // ранее сохранённая оплата", а не "оплата не выбрана". Обнулять
      // selectedId здесь — заманчивое "исправление одной строкой", которое на
      // деле ломает именно эту проверку (найдено и исправлено при тестировании).
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const activeSubscriptions = (subscriptions ?? []).filter(isSubscriptionSelectable)
  // "Старые" — всё, что нельзя выбрать для списания (used/cancelled/refunded/
  // архивные), но их всё ещё можно открыть/посмотреть/вернуть из архива —
  // см. ТЗ: "чтобы администратор видел историю и мог вручную отправить
  // старый абонемент в архив или проверить его".
  const oldSubscriptions = (subscriptions ?? []).filter(s => !isSubscriptionSelectable(s))
  const selected = activeSubscriptions.find(s => s.id === selectedId) ?? null
  const usedHoursNum = parseFloat(usedHours)
  const overspend = mode === 'SUBSCRIPTION' && !creatingNew && !!selected && Number.isFinite(usedHoursNum) && usedHoursNum > selected.remainingHours

  useEffect(() => {
    if (mode === 'ONE_TIME') { onValidityChange(true); return }
    if (subscriptions === null) { onValidityChange(false); return }
    if (!Number.isFinite(usedHoursNum) || usedHoursNum <= 0) { onValidityChange(false); return }
    if (creatingNew) {
      const packageHours = parseInt(newPackageHours, 10)
      onValidityChange(Number.isFinite(packageHours) && packageHours > 0 && usedHoursNum <= packageHours)
      return
    }
    // Запись уже была списана с этого абонемента раньше, и админ здесь ничего
    // не поменял (не выбрал другой абонемент, не изменил списанные часы) —
    // прежняя оплата остаётся валидной, даже если сам абонемент с тех пор
    // закончился (стал USED_UP/EXPIRED). Без этой ветки любое редактирование
    // карточки записи — например, просто добавление ссылки на Яндекс.Диск —
    // молча блокировало «Сохранить», потому что абонемент, которым когда-то
    // оплатили именно эту запись, к сегодняшнему дню исчерпан — при том что
    // сам факт той оплаты никто не оспаривает и менять не пытается.
    if (initialUsage && selectedId === initialUsage.subscriptionId && usedHoursNum === initialUsage.usedHours) {
      onValidityChange(true)
      return
    }
    const sel = activeSubscriptions.find(s => s.id === selectedId)
    onValidityChange(!!sel && usedHoursNum <= sel.remainingHours)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, creatingNew, selectedId, usedHours, newPackageHours, subscriptions])

  useImperativeHandle(ref, () => ({
    getValue(): SubscriptionPaymentValue {
      if (mode === 'ONE_TIME') return { paymentType: 'ONE_TIME' }
      if (creatingNew) {
        return {
          paymentType: 'NEW',
          packageHours: parseInt(newPackageHours, 10),
          paidAmount: newPaidAmount ? parseFloat(newPaidAmount) : null,
          purchasedAt: newPurchasedAt,
          usedHours: usedHoursNum,
        }
      }
      return { paymentType: 'EXISTING', subscriptionId: selectedId as string, usedHours: usedHoursNum }
    },
  }))

  function selectMode(next: 'ONE_TIME' | 'SUBSCRIPTION') {
    setMode(next)
    onModeChange(next)
  }

  // После любого действия (отметить использованным/аннулировать/возврат/
  // архив) над абонементом этого клиента — перезапросить список: тот же
  // updateSubscriptionStatus, что и в Финансах/карточке клиента, поэтому
  // изменение сразу видно и здесь, без отдельной логики синхронизации.
  async function handleSubscriptionChanged() {
    const data = await fetchSubscriptions()
    const stillSelectable = data.find(s => s.id === selectedId && isSubscriptionSelectable(s))
    if (!stillSelectable) {
      const active = data.filter(isSubscriptionSelectable)
      setSelectedId(active[0]?.id ?? null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => selectMode('ONE_TIME')} className={pillClass(mode === 'ONE_TIME')}>
          Разовая оплата
        </button>
        <button type="button" onClick={() => selectMode('SUBSCRIPTION')} className={pillClass(mode === 'SUBSCRIPTION')}>
          Абонемент
        </button>
      </div>

      {mode === 'SUBSCRIPTION' && (
        <div className="space-y-3 bg-zinc-800/40 rounded-lg p-3">
          {subscriptions === null ? (
            <p className="text-zinc-500 text-xs">Загрузка абонементов...</p>
          ) : (
            <>
              {!creatingNew && activeSubscriptions.length > 0 && (
                <div className="space-y-2">
                  <label className={LABEL}>Активные абонементы</label>
                  {activeSubscriptions.map((s, idx) => {
                    const displayStatus = getSubscriptionDisplayStatus(s)
                    const isSelected = s.id === selectedId
                    return (
                      <div key={s.id} className={`rounded-lg border p-2.5 transition-colors ${
                        isSelected ? 'border-[#00c26b] bg-[#00c26b]/5' : 'border-zinc-700 bg-zinc-900/40'
                      }`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-zinc-100 text-sm font-medium">Абонемент №{idx + 1} · {s.packageHours} ч</p>
                            <p className="text-zinc-400 text-xs mt-0.5">
                              Осталось: {s.remainingHours} ч · Дата покупки: {format(parseISO(s.purchasedAt), 'd MMM yyyy')}
                            </p>
                            <span className={`inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${SUBSCRIPTION_DISPLAY_STATUS_COLORS[displayStatus]}`}>
                              {SUBSCRIPTION_DISPLAY_STATUS_LABELS[displayStatus]}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button type="button" onClick={() => setSelectedId(s.id)}
                              className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${
                                isSelected ? 'bg-[#00c26b] text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                              }`}>
                              {isSelected ? 'Выбран' : 'Выбрать'}
                            </button>
                            <SubscriptionActionsMenu subscription={s} onChanged={handleSubscriptionChanged} variant="compact" />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <button type="button" onClick={() => setCreatingNew(true)} className="text-xs text-zinc-400 hover:text-white underline">
                    + Создать новый абонемент
                  </button>
                </div>
              )}

              {!creatingNew && activeSubscriptions.length === 0 && (
                <div className="text-center py-1">
                  {initialUsage && selectedId === initialUsage.subscriptionId ? (
                    <p className="text-zinc-400 text-xs mb-2">
                      Эта запись уже была оплачена абонементом от {format(parseISO(initialUsage.purchasedAt), 'dd.MM.yyyy')}
                      {' '}({initialUsage.usedHours} ч) — он с тех пор закончился, но саму оплату менять не нужно, можно просто «Сохранить».
                    </p>
                  ) : (
                    <p className="text-zinc-400 text-xs mb-2">У клиента нет активных абонементов.</p>
                  )}
                  <button type="button" onClick={() => setCreatingNew(true)}
                    className="text-xs text-[#00c26b] hover:underline font-medium">
                    + Создать абонемент
                  </button>
                </div>
              )}

              {creatingNew && (
                <div className="space-y-3">
                  {activeSubscriptions.length > 0 && (
                    <button type="button" onClick={() => setCreatingNew(false)} className="text-xs text-zinc-400 hover:text-white underline">
                      ← Выбрать существующий абонемент
                    </button>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={LABEL}>Размер абонемента</label>
                      <select className={SELECT} value={newPackageHours} onChange={e => setNewPackageHours(e.target.value)}>
                        {PACKAGE_OPTIONS.map(h => <option key={h} value={h}>{h} часов</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL}>Сумма абонемента, ₽</label>
                      <input className={INPUT} type="number" min="0" placeholder="напр. 45000" value={newPaidAmount}
                        onChange={e => setNewPaidAmount(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className={LABEL}>Дата покупки</label>
                    <input className={INPUT} type="date" value={newPurchasedAt} onChange={e => setNewPurchasedAt(e.target.value)} />
                  </div>
                </div>
              )}

              {(creatingNew || activeSubscriptions.length > 0) && (
                <>
                  <div>
                    <label className={LABEL}>Списать часов за эту запись</label>
                    <input className={INPUT} type="number" min="0" step="0.25" value={usedHours} onChange={e => setUsedHours(e.target.value)} />
                  </div>

                  {overspend && selected ? (
                    <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs bg-red-950/40 border border-red-900 text-red-300">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <p>
                        В абонементе осталось только {selected.remainingHours} ч. Для этой записи нужно списать {usedHours} ч —
                        уменьшите часы или выберите другой абонемент.
                      </p>
                    </div>
                  ) : (
                    !creatingNew && selected && Number.isFinite(usedHoursNum) && usedHoursNum > 0 && (
                      <p className="text-zinc-400 text-xs px-1">
                        Будет списано {usedHours} ч, после записи останется {Math.round((selected.remainingHours - usedHoursNum) * 100) / 100} ч.
                      </p>
                    )
                  )}
                </>
              )}

              {oldSubscriptions.length > 0 && (
                <div className="pt-2 border-t border-zinc-700/60">
                  <button type="button" onClick={() => setShowOld(v => !v)} className="text-xs text-zinc-400 hover:text-white underline">
                    {showOld ? 'Скрыть старые абонементы' : `Старые абонементы (${oldSubscriptions.length})`}
                  </button>
                  {showOld && (
                    <div className="space-y-2 mt-2">
                      {oldSubscriptions.map((s, idx) => {
                        const displayStatus = getSubscriptionDisplayStatus(s)
                        return (
                          <div key={s.id} className="rounded-lg border border-zinc-700/60 bg-zinc-900/30 p-2.5 flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-zinc-300 text-xs font-medium">Абонемент №{idx + 1} · {s.packageHours} ч</p>
                              <p className="text-zinc-500 text-[11px] mt-0.5">
                                Осталось: {s.remainingHours} ч · от {format(parseISO(s.purchasedAt), 'd MMM yyyy')}
                              </p>
                              <div className="flex items-center gap-1 flex-wrap mt-1">
                                <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border ${SUBSCRIPTION_DISPLAY_STATUS_COLORS[displayStatus]}`}>
                                  {SUBSCRIPTION_DISPLAY_STATUS_LABELS[displayStatus]}
                                </span>
                                {s.isArchived && (
                                  <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border ${SUBSCRIPTION_ARCHIVED_BADGE_CLASS}`}>
                                    {SUBSCRIPTION_ARCHIVED_BADGE_LABEL}
                                  </span>
                                )}
                              </div>
                            </div>
                            <SubscriptionActionsMenu subscription={s} onChanged={handleSubscriptionChanged} variant="compact" />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
})

export default SubscriptionPaymentBlock
