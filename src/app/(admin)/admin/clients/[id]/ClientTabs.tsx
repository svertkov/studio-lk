'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShoppingBag, Film, DollarSign, FileText, HardDrive, Upload, Send, Calendar, Clock, Wallet, Receipt } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  CLIENT_TYPE_LABELS, CLIENT_STATUS_LABELS, CLIENT_SOURCE_LABELS,
} from '@/lib/client-model'
import { addClientNote } from '@/lib/actions/clients'
import type { ClientSubscriptionDTO } from '@/lib/actions/subscriptions'
import type { ClientBookingDTO } from '@/lib/actions/schedule'
import { SUBSCRIPTION_STATUS_LABELS, SUBSCRIPTION_STATUS_COLORS } from '@/lib/subscription-model'
import { PAYMENT_METHOD_LABELS } from '@/lib/schedule-model'
import { computeVisitStats } from '@/lib/visit-stats'
import DonutChart from '@/components/ui/donut-chart'
import MetricCard from '@/components/ui/metric-card'

const CHART_COLORS = ['#00c26b', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6']

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

function formatDate(v: string | Date | null) {
  if (!v) return '—'
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface ClientNote {
  id: string
  text: string
  authorId: string | null
  createdAt: string | Date
}

interface ClientContact {
  id: string
  name?: string | null
  role?: string | null
  phone?: string | null
  telegram?: string | null
  email?: string | null
  comment?: string | null
}

interface ClientDoc {
  id: string
  fileName: string
  storageUrl: string
  type?: string | null
  createdAt: string | Date
}

interface ClientVisitRow {
  id: string
  date: string | Date | null
  room: string | null
  format: string | null
  durationHours: number | null
  grossAmount: number | null
  netAmount: number | null
  comment: string | null
}

interface PrismaClient {
  id: string
  name: string
  type: string
  status: string
  source?: string | null
  customSource?: string | null
  contactPerson?: string | null
  phone?: string | null
  telegram?: string | null
  email?: string | null
  companyName?: string | null
  inn?: string | null
  kpp?: string | null
  ogrn?: string | null
  legalAddress?: string | null
  documentComment?: string | null
  notes?: string | null
  createdAt: string | Date
  clientNotes: ClientNote[]
  contacts: ClientContact[]
  documents: ClientDoc[]
  visits: ClientVisitRow[]
}

interface Props {
  client: PrismaClient
  subscriptions: ClientSubscriptionDTO[]
  bookings: ClientBookingDTO[]
}

const TABS = [
  { id: 'overview',   label: 'Обзор' },
  { id: 'sessions',   label: 'Съёмки' },
  { id: 'orders',     label: 'Заказы' },
  { id: 'editing',    label: 'Монтаж' },
  { id: 'finance',    label: 'Финансы' },
  { id: 'documents',  label: 'Документы' },
  { id: 'materials',  label: 'Материалы' },
  { id: 'notes',      label: 'Заметки' },
]

function PlaceholderTab({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
      <Icon className="w-10 h-10 text-zinc-600 mx-auto mb-4" />
      <p className="text-zinc-300 font-medium">{title}</p>
      <p className="text-zinc-500 text-sm mt-1.5 max-w-sm mx-auto">{description}</p>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div>
      <p className="text-zinc-500 text-xs mb-1">{label}</p>
      <p className="text-zinc-200 text-sm">{value}</p>
    </div>
  )
}

export default function ClientTabs({ client, subscriptions, bookings }: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('overview')
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  const isLegal = client.type !== 'INDIVIDUAL' && client.type !== 'SELF_EMPLOYED'
  const visitStats = computeVisitStats(
    client.visits.map(v => ({ ...v, date: v.date ? new Date(v.date) : null }))
  )
  // Записи, оплаченные по абонементу, уже показаны в истории списаний самого
  // абонемента ниже — здесь показываем только те, что оплачивались отдельно.
  const oneTimeBookings = bookings.filter(b => b.subscriptionUsedHours == null)

  async function handleSaveNote() {
    if (!noteText.trim()) return
    setSavingNote(true)
    setNoteError(null)
    const result = await addClientNote(client.id, noteText)
    setSavingNote(false)
    if (result.ok) {
      setNoteText('')
      router.refresh()
    } else {
      setNoteError(result.error ?? 'Ошибка сохранения')
    }
  }

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1.5 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-shrink-0 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-zinc-700 text-white'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {/* Обзор */}
        {activeTab === 'overview' && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
            <h3 className="text-white font-semibold">Информация о клиенте</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoRow label="Имя / название" value={client.name} />
              <InfoRow label="Контактное лицо" value={client.contactPerson} />
              <InfoRow label="Тип" value={CLIENT_TYPE_LABELS[client.type as keyof typeof CLIENT_TYPE_LABELS]} />
              <InfoRow label="Статус" value={CLIENT_STATUS_LABELS[client.status as keyof typeof CLIENT_STATUS_LABELS]} />
              <InfoRow label="Телефон" value={client.phone} />
              <InfoRow label="Telegram" value={client.telegram} />
              <InfoRow label="Email" value={client.email} />
              <InfoRow
                label="Источник"
                value={client.source ? CLIENT_SOURCE_LABELS[client.source as keyof typeof CLIENT_SOURCE_LABELS] : undefined}
              />
              {client.source === 'OTHER' && client.customSource && (
                <InfoRow label="Уточнение источника" value={client.customSource} />
              )}
              <InfoRow
                label="Добавлен"
                value={new Date(client.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
              />
            </div>

            {isLegal && (client.companyName || client.inn || client.kpp || client.ogrn || client.legalAddress) && (
              <div className="pt-4 border-t border-zinc-800">
                <p className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-3">Реквизиты</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InfoRow label="Название компании" value={client.companyName} />
                  <InfoRow label="ИНН" value={client.inn} />
                  <InfoRow label="КПП" value={client.kpp} />
                  <InfoRow label="ОГРН / ОГРНИП" value={client.ogrn} />
                  <InfoRow label="Юридический адрес" value={client.legalAddress} />
                  <InfoRow label="Комментарий по документам" value={client.documentComment} />
                </div>
              </div>
            )}

            {client.notes && (
              <div className="pt-4 border-t border-zinc-800">
                <p className="text-zinc-400 text-xs mb-2">Внутренний комментарий</p>
                <p className="text-zinc-300 text-sm whitespace-pre-wrap">{client.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Съёмки */}
        {activeTab === 'sessions' && (
          client.visits.length === 0 ? (
            <PlaceholderTab
              icon={Calendar}
              title="История визитов пока не импортирована"
              description="Импортируйте базу клиентов из Excel, PDF или Google-таблицы, чтобы увидеть визиты, часы и суммы"
            />
          ) : (
            <div className="space-y-4">
              {/* Метрики */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                <MetricCard icon={Calendar} label="Визитов" value={String(visitStats.totalVisits)} />
                <MetricCard icon={Clock} label="Часов в студии" value={visitStats.totalHours.toFixed(1)} />
                <MetricCard icon={Wallet} label="Выручка" value={formatMoney(visitStats.grossTotal)} />
                <MetricCard icon={Receipt} label="Чистая прибыль" value={formatMoney(visitStats.netTotal)} />
                <MetricCard icon={DollarSign} label="Средний чек" value={formatMoney(visitStats.avgCheck)} />
              </div>

              {/* Диаграммы */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-white font-semibold text-sm mb-4">По залам</h3>
                  <DonutChart
                    emptyLabel="Нет данных о залах"
                    data={visitStats.byRoom.map((r, i) => ({ label: r.label, value: r.percent, color: CHART_COLORS[i % CHART_COLORS.length] }))}
                  />
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <h3 className="text-white font-semibold text-sm mb-4">По форматам записи</h3>
                  <DonutChart
                    emptyLabel="Нет данных о форматах"
                    data={visitStats.byFormat.map((f, i) => ({ label: f.label, value: f.percent, color: CHART_COLORS[i % CHART_COLORS.length] }))}
                  />
                </div>
              </div>

              {/* История визитов */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-zinc-800">
                  <h3 className="text-white font-semibold text-sm">История визитов</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-800/40">
                        <th className="text-left px-4 py-2.5 text-zinc-400 text-xs uppercase tracking-wider font-medium">Дата</th>
                        <th className="text-left px-4 py-2.5 text-zinc-400 text-xs uppercase tracking-wider font-medium">Зал</th>
                        <th className="text-left px-4 py-2.5 text-zinc-400 text-xs uppercase tracking-wider font-medium">Формат</th>
                        <th className="text-left px-4 py-2.5 text-zinc-400 text-xs uppercase tracking-wider font-medium">Часы</th>
                        <th className="text-left px-4 py-2.5 text-zinc-400 text-xs uppercase tracking-wider font-medium">Сумма</th>
                        <th className="text-left px-4 py-2.5 text-zinc-400 text-xs uppercase tracking-wider font-medium">Комментарий</th>
                      </tr>
                    </thead>
                    <tbody>
                      {client.visits.map((v, i) => (
                        <tr key={v.id} className={`border-b border-zinc-800/60 ${i === client.visits.length - 1 ? 'border-b-0' : ''}`}>
                          <td className="px-4 py-2.5 text-zinc-300 text-sm">{formatDate(v.date)}</td>
                          <td className="px-4 py-2.5 text-zinc-400 text-sm">{v.room ?? '—'}</td>
                          <td className="px-4 py-2.5 text-zinc-400 text-sm">{v.format ?? '—'}</td>
                          <td className="px-4 py-2.5 text-zinc-400 text-sm">{v.durationHours ?? '—'}</td>
                          <td className="px-4 py-2.5 text-zinc-400 text-sm">{v.grossAmount != null ? formatMoney(v.grossAmount) : '—'}</td>
                          <td className="px-4 py-2.5 text-zinc-500 text-xs max-w-xs truncate">{v.comment ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )
        )}

        {/* Заказы */}
        {activeTab === 'orders' && (
          <PlaceholderTab
            icon={ShoppingBag}
            title="Заказы клиента"
            description="Здесь будут заказы и проекты этого клиента: статусы, суммы, дедлайны"
          />
        )}

        {/* Монтаж */}
        {activeTab === 'editing' && (
          <PlaceholderTab
            icon={Film}
            title="Задачи монтажа"
            description="Здесь будут задачи по монтажу: монтажёр, статус, исходники, результат"
          />
        )}

        {/* Финансы */}
        {activeTab === 'finance' && (
          subscriptions.length === 0 && oneTimeBookings.length === 0 ? (
            <PlaceholderTab
              icon={DollarSign}
              title="Абонементов и оплат пока нет"
              description="Абонемент или способ оплаты можно указать в карточке записи расписания"
            />
          ) : (
            <div className="space-y-4">
              {oneTimeBookings.length > 0 && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  <div className="px-6 py-4 border-b border-zinc-800">
                    <h3 className="text-white font-semibold text-sm">Разовые оплаты по записям в расписании</h3>
                  </div>
                  <div className="divide-y divide-zinc-800/60">
                    {oneTimeBookings.map(b => (
                      <div key={b.id} className="flex items-center justify-between gap-4 px-6 py-3">
                        <div className="min-w-0">
                          <p className="text-zinc-200 text-sm truncate">{b.title ?? 'Запись'}</p>
                          <p className="text-zinc-500 text-xs mt-0.5">
                            {b.startAt ? formatDate(b.startAt) : '—'}
                            {b.room && ` · ${b.room}`}
                            {b.format && ` · ${b.format}`}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-white text-sm font-medium">{b.estimatedPrice != null ? formatMoney(b.estimatedPrice) : '—'}</p>
                          <p className="text-zinc-500 text-xs mt-0.5">{b.paymentMethod ? PAYMENT_METHOD_LABELS[b.paymentMethod] : 'способ не указан'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {subscriptions.map(sub => (
                <div key={sub.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-white font-semibold">Абонемент от {formatDate(sub.purchasedAt)}</p>
                      <p className="text-zinc-400 text-sm mt-0.5">
                        {sub.packageHours} часов
                        {sub.paidAmount != null && ` · оплачено ${formatMoney(sub.paidAmount)}`}
                      </p>
                    </div>
                    <Badge variant="outline" className={`text-xs ${SUBSCRIPTION_STATUS_COLORS[sub.status]}`}>
                      {SUBSCRIPTION_STATUS_LABELS[sub.status]}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
                    <div>
                      <p className="text-zinc-500 text-xs">Использовано</p>
                      <p className="text-white font-semibold mt-0.5">{sub.usedHours} ч</p>
                    </div>
                    <div>
                      <p className="text-zinc-500 text-xs">Осталось</p>
                      <p className="text-white font-semibold mt-0.5">{sub.remainingHours} ч</p>
                    </div>
                  </div>
                  {sub.usages.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-zinc-800 space-y-1.5">
                      <p className="text-zinc-500 text-xs uppercase tracking-wider mb-2">История списаний</p>
                      {sub.usages.map(u => (
                        <div key={u.id} className="flex items-center justify-between text-sm">
                          <span className="text-zinc-300">{formatDate(u.usedAt)} · {u.eventTitle ?? 'Запись'}</span>
                          <span className="text-zinc-400">{u.usedHours} ч</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {/* Документы */}
        {activeTab === 'documents' && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold">Документы</h3>
              <button className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm px-3 py-2 rounded-lg transition-colors">
                <Upload className="w-3.5 h-3.5" />
                Добавить документ
              </button>
            </div>
            {client.documents.length === 0 ? (
              <div className="border border-dashed border-zinc-700 rounded-xl p-10 text-center">
                <FileText className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
                <p className="text-zinc-400 text-sm">Документов пока нет</p>
                <p className="text-zinc-600 text-xs mt-1">Договоры, счета, акты и приложения</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {client.documents.map(doc => (
                  <li key={doc.id} className="flex items-center gap-3 bg-zinc-800 rounded-lg px-4 py-3">
                    <FileText className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                    <span className="text-zinc-200 text-sm flex-1">{doc.fileName}</span>
                    {doc.storageUrl && (
                      <a href={doc.storageUrl} target="_blank" rel="noopener noreferrer"
                        className="text-[#00c26b] text-xs hover:underline">
                        Открыть
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Материалы */}
        {activeTab === 'materials' && (
          <PlaceholderTab
            icon={HardDrive}
            title="Материалы клиента"
            description="Ссылки на исходники, готовые ролики и архивы по съёмкам этого клиента"
          />
        )}

        {/* Заметки */}
        {activeTab === 'notes' && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-5">
            <h3 className="text-white font-semibold">Внутренние заметки</h3>

            {/* Existing notes */}
            {client.clientNotes.length > 0 && (
              <div className="space-y-3">
                {client.clientNotes.map(note => (
                  <div key={note.id} className="bg-zinc-800 rounded-lg px-4 py-3 space-y-1">
                    <p className="text-zinc-200 text-sm whitespace-pre-wrap">{note.text}</p>
                    <p className="text-zinc-600 text-xs">
                      {new Date(note.createdAt).toLocaleDateString('ru-RU', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* New note input */}
            <div className="pt-2 border-t border-zinc-800 space-y-3">
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Добавить заметку..."
                rows={4}
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder-zinc-600 rounded-lg px-4 py-3 text-sm outline-none focus:border-[#00c26b] transition-colors resize-none"
              />
              {noteError && (
                <p className="text-red-400 text-sm">{noteError}</p>
              )}
              <button
                onClick={handleSaveNote}
                disabled={savingNote || !noteText.trim()}
                className="flex items-center gap-2 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white font-medium text-sm px-4 py-2 rounded-lg transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                {savingNote ? 'Сохранение...' : 'Добавить заметку'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
