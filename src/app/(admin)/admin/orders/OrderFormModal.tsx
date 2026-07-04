'use client'

import { useState, type ReactNode, type SelectHTMLAttributes } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { Search, Link2, UserPlus, ChevronDown } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { createOrder, updateOrder, updateOrderStatus, type OrderDTO, type OrderInput } from '@/lib/actions/orders'
import { getClients } from '@/lib/actions/clients'
import { ORDER_BOARD_COLUMNS, ORDER_STATUS_LABELS, ORDER_PAYMENT_STATUS_LABELS, ORDER_PAYMENT_METHOD_LABELS } from '@/lib/order-model'
import { CLIENT_TYPE_LABELS } from '@/lib/client-model'
import { ROOM_DICTIONARY, FORMAT_DICTIONARY } from '@/lib/import/normalize'
import type { ClientType, OrderStatus, OrderPaymentStatus, PaymentMethod } from '@prisma/client'
import AddClientModal from '../clients/AddClientModal'

interface Props {
  order: OrderDTO | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

interface ClientOption {
  id: string
  name: string
  phone?: string | null
  companyName?: string | null
}

// Общая геометрия для инпутов и селектов в одной сетке: одинаковая высота
// (h-10), рамка и радиус — иначе нативный select рендерится не той же высоты,
// что input, и ряд "съезжает" (см. FIELD_BASE/INPUT/SELECT ниже).
const FIELD_BASE = 'w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg text-sm outline-none focus:border-[#00c26b] transition-colors'
const INPUT = `${FIELD_BASE} px-3 text-zinc-100 placeholder-zinc-600`
const SELECT = `${FIELD_BASE} pl-3 pr-9 text-zinc-200 cursor-pointer appearance-none`
const TEXTAREA = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors resize-none'
const LABEL = 'block text-zinc-400 text-xs'
const SECTION = 'text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-3 mt-5 first:mt-0 pt-4 border-t border-zinc-800/80 first:border-0 first:pt-0'

// Единая структура "поле": лейбл сверху, контрол снизу, фиксированный зазор
// между ними — вместо margin на отдельных лейблах/инпутах по всей форме.
function Field({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>
}

// Единая структура "строка из двух полей": на десктопе 2 колонки, на узких
// экранах складывается в одну — без ручных отступов на отдельных полях.
function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
}

function Label({ children }: { children: ReactNode }) {
  return <label className={LABEL}>{children}</label>
}

// select с appearance-none + своя стрелка — чтобы высота и позиция control
// всегда совпадали с input рядом (нативный select иначе рисует свою высоту).
function SelectField({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={SELECT}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
    </div>
  )
}

function splitDateTime(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const d = parseISO(iso)
  return { date: format(d, 'yyyy-MM-dd'), time: format(d, 'HH:mm') }
}

function combineDateTime(date: string, time: string): string | null {
  if (!date || !time) return null
  const d = new Date(`${date}T${time}:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export default function OrderFormModal({ order, onOpenChange, onSaved }: Props) {
  const isEdit = !!order
  const startSplit = splitDateTime(order?.plannedStartTime ?? null)
  const endSplit = splitDateTime(order?.plannedEndTime ?? null)

  const [clientId, setClientId] = useState<string | null>(order?.clientId ?? null)
  const [clientName, setClientName] = useState(order?.clientName ?? '')
  const [clientPhone, setClientPhone] = useState(order?.clientPhone ?? '')
  const [clientTelegram, setClientTelegram] = useState(order?.clientTelegram ?? '')
  const [clientEmail, setClientEmail] = useState(order?.clientEmail ?? '')
  const [clientType, setClientType] = useState<ClientType | ''>(order?.clientType ?? '')
  const [companyName, setCompanyName] = useState(order?.companyName ?? '')
  const [serviceType, setServiceType] = useState(order?.serviceType ?? '')
  const [room, setRoom] = useState(order?.room ?? '')
  const [comment, setComment] = useState(order?.comment ?? '')
  const [preliminaryAmount, setPreliminaryAmount] = useState(order?.preliminaryAmount?.toString() ?? '')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>(order?.paymentMethod ?? '')
  const [paymentStatus, setPaymentStatus] = useState<OrderPaymentStatus>(order?.paymentStatus ?? 'NOT_SPECIFIED')
  const [status, setStatus] = useState<OrderStatus>(order?.status ?? 'LEAD')

  const [date, setDate] = useState(startSplit.date)
  const [startTime, setStartTime] = useState(startSplit.time)
  const [endTime, setEndTime] = useState(endSplit.time)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ClientOption[]>([])
  const [searching, setSearching] = useState(false)
  const [addClientOpen, setAddClientOpen] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClientSearch(value: string) {
    setSearchQuery(value)
    if (value.trim().length < 2) { setSearchResults([]); return }
    setSearching(true)
    const res = await getClients({ search: value.trim() })
    setSearching(false)
    if (res.ok) setSearchResults(res.data.filter((c: ClientOption) => c.id !== clientId).slice(0, 8))
  }

  function selectClient(c: ClientOption) {
    setClientId(c.id)
    setClientName(c.name)
    if (c.phone) setClientPhone(c.phone)
    if (c.companyName) setCompanyName(c.companyName)
    setSearchQuery('')
    setSearchResults([])
  }

  function unlinkClient() {
    setClientId(null)
  }

  async function handleSave() {
    if (!clientId && !clientName.trim()) {
      setError('Укажите имя клиента или название заявки')
      return
    }
    setSaving(true)
    setError(null)

    const input: OrderInput = {
      title: clientName.trim() || undefined,
      clientId,
      clientName: clientName.trim(),
      clientPhone: clientPhone.trim(),
      clientTelegram: clientTelegram.trim(),
      clientEmail: clientEmail.trim(),
      clientType: clientType || null,
      companyName: companyName.trim(),
      serviceType: serviceType.trim(),
      room: room.trim(),
      comment: comment.trim(),
      preliminaryAmount: preliminaryAmount ? parseFloat(preliminaryAmount) : null,
      paymentMethod: paymentMethod || null,
      paymentStatus,
      plannedStartTime: combineDateTime(date, startTime),
      plannedEndTime: combineDateTime(date, endTime),
    }

    const result = isEdit ? await updateOrder(order!.id, input) : await createOrder(input)
    if (!result.ok) {
      setSaving(false)
      setError(result.error)
      return
    }

    if (isEdit && status !== order!.status) {
      const statusResult = await updateOrderStatus(order!.id, status)
      if (!statusResult.ok) {
        setSaving(false)
        setError(statusResult.error)
        return
      }
    }

    setSaving(false)
    onSaved()
    onOpenChange(false)
  }

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-xl sm:max-w-[662px] max-h-[88vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800 flex-shrink-0">
            <DialogTitle className="text-white text-lg font-semibold">
              {isEdit ? 'Заказ' : 'Новый заказ'}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {isEdit && (
              <>
                <p className={SECTION}>Статус</p>
                <SelectField value={status} onChange={e => setStatus(e.target.value as OrderStatus)}>
                  {ORDER_BOARD_COLUMNS.map(s => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
                </SelectField>
              </>
            )}

            <p className={SECTION}>Клиент</p>
            {clientId ? (
              <div className="bg-zinc-800/50 rounded-lg p-3 flex items-center justify-between gap-3">
                <p className="text-zinc-200 text-sm truncate">{clientName || 'Без имени'}</p>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Link href={`/admin/clients/${clientId}`} className="text-xs text-[#00c26b] hover:underline">
                    Открыть карточку
                  </Link>
                  <button type="button" onClick={unlinkClient} className="text-xs text-zinc-400 hover:text-white underline">
                    Отвязать
                  </button>
                </div>
              </div>
            ) : (
              <>
                <Field>
                  <Label>Имя клиента или название заявки *</Label>
                  <input className={INPUT} placeholder="Например, Сергей Соломатин" value={clientName}
                    onChange={e => setClientName(e.target.value)} />
                </Field>
                <Row>
                  <Field>
                    <Label>Телефон</Label>
                    <input className={INPUT} placeholder="+7..." value={clientPhone} onChange={e => setClientPhone(e.target.value)} />
                  </Field>
                  <Field>
                    <Label>Telegram</Label>
                    <input className={INPUT} placeholder="@username" value={clientTelegram} onChange={e => setClientTelegram(e.target.value)} />
                  </Field>
                </Row>
                <Row>
                  <Field>
                    <Label>Email</Label>
                    <input className={INPUT} placeholder="mail@example.com" value={clientEmail} onChange={e => setClientEmail(e.target.value)} />
                  </Field>
                  <Field>
                    <Label>Тип клиента</Label>
                    <SelectField value={clientType} onChange={e => setClientType(e.target.value as ClientType | '')}>
                      <option value="">Не указан</option>
                      {(Object.keys(CLIENT_TYPE_LABELS) as ClientType[]).map(t => (
                        <option key={t} value={t}>{CLIENT_TYPE_LABELS[t]}</option>
                      ))}
                    </SelectField>
                  </Field>
                </Row>
                <Field>
                  <Label>Компания</Label>
                  <input className={INPUT} placeholder="Если известна" value={companyName} onChange={e => setCompanyName(e.target.value)} />
                </Field>

                <div>
                  <Field>
                    <Label>Найти существующего клиента</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                      <input
                        value={searchQuery}
                        onChange={e => handleClientSearch(e.target.value)}
                        placeholder="Имя или телефон..."
                        className={`${INPUT} pl-9`}
                      />
                    </div>
                  </Field>
                  {searching && <p className="text-zinc-500 text-xs mt-1.5">Ищу...</p>}
                  {!searching && searchResults.length > 0 && (
                    <div className="mt-1.5 border border-zinc-800 rounded-lg overflow-hidden divide-y divide-zinc-800">
                      {searchResults.map(c => (
                        <button key={c.id} type="button" onClick={() => selectClient(c)}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-zinc-800/60 transition-colors">
                          <div className="min-w-0">
                            <p className="text-zinc-200 text-xs truncate">{c.name}</p>
                            <p className="text-zinc-500 text-[11px] truncate">{c.phone || c.companyName || '—'}</p>
                          </div>
                          <Link2 className="w-3.5 h-3.5 text-[#00c26b] flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                  <button type="button" onClick={() => setAddClientOpen(true)}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white underline mt-2">
                    <UserPlus className="w-3.5 h-3.5" />
                    Создать нового клиента
                  </button>
                </div>
              </>
            )}

            <p className={SECTION}>Услуга</p>
            <Row>
              <Field>
                <Label>Формат</Label>
                <SelectField value={serviceType} onChange={e => setServiceType(e.target.value)}>
                  <option value="">Не указан</option>
                  {FORMAT_DICTIONARY.map(e => <option key={e.canonical} value={e.canonical}>{e.canonical}</option>)}
                </SelectField>
              </Field>
              <Field>
                <Label>Зал</Label>
                <SelectField value={room} onChange={e => setRoom(e.target.value)}>
                  <option value="">Не указан</option>
                  {ROOM_DICTIONARY.map(e => <option key={e.canonical} value={e.canonical}>{e.canonical}</option>)}
                </SelectField>
              </Field>
            </Row>
            <Field>
              <Label>Комментарий</Label>
              <textarea className={TEXTAREA} rows={2} value={comment} onChange={e => setComment(e.target.value)} />
            </Field>

            <p className={SECTION}>Запись в студию</p>
            <p className="text-zinc-500 text-xs -mt-2 mb-1">Можно оставить пустым — заказ останется заявкой.</p>
            <Field>
              <Label>Дата</Label>
              <input className={INPUT} type="date" value={date} onChange={e => setDate(e.target.value)} />
            </Field>
            <Row>
              <Field>
                <Label>Время начала</Label>
                <input className={INPUT} type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
              </Field>
              <Field>
                <Label>Время окончания</Label>
                <input className={INPUT} type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
              </Field>
            </Row>
            {isEdit && order?.hasBooking && (
              <p className="text-zinc-500 text-xs">
                У заказа уже есть запись в расписании платформы — при изменении даты/времени она обновится.
              </p>
            )}

            <p className={SECTION}>Оплата</p>
            <Row>
              <Field>
                <Label>Предварительная стоимость, ₽</Label>
                <input className={INPUT} type="number" min="0" placeholder="напр. 15000" value={preliminaryAmount}
                  onChange={e => setPreliminaryAmount(e.target.value)} />
              </Field>
              <Field>
                <Label>Способ оплаты</Label>
                <SelectField value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod | '')}>
                  <option value="">Не указан</option>
                  {(Object.keys(ORDER_PAYMENT_METHOD_LABELS) as PaymentMethod[]).map(m => (
                    <option key={m} value={m}>{ORDER_PAYMENT_METHOD_LABELS[m]}</option>
                  ))}
                </SelectField>
              </Field>
            </Row>
            <Field>
              <Label>Статус оплаты</Label>
              <SelectField value={paymentStatus} onChange={e => setPaymentStatus(e.target.value as OrderPaymentStatus)}>
                {(Object.keys(ORDER_PAYMENT_STATUS_LABELS) as OrderPaymentStatus[]).map(s => (
                  <option key={s} value={s}>{ORDER_PAYMENT_STATUS_LABELS[s]}</option>
                ))}
              </SelectField>
            </Field>

            {error && (
              <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>

          <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
            <button type="button" onClick={handleSave} disabled={saving}
              className="flex-1 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors">
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
            <button type="button" onClick={() => onOpenChange(false)}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">
              Закрыть
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {addClientOpen && (
        <AddClientModal
          open={addClientOpen}
          onOpenChange={setAddClientOpen}
          onSuccess={() => {}}
          initialValues={{
            firstName: clientName.trim(),
            contactPerson: clientName.trim(),
            phone: clientPhone.trim(),
            telegram: clientTelegram.trim(),
            email: clientEmail.trim(),
            companyName: companyName.trim(),
          }}
          onCreated={client => { setAddClientOpen(false); selectClient({ id: client.id, name: client.name }) }}
        />
      )}
    </>
  )
}
