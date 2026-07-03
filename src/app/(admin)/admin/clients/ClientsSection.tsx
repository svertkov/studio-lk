'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Users, UserCheck, Building2, AlertCircle, Star,
  Search, ArrowUp, ArrowDown, ArrowUpDown, ChevronRight,
  WifiOff,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  type ClientType, type ClientStatus,
  CLIENT_TYPE_LABELS, CLIENT_TYPE_COLORS,
  CLIENT_STATUS_LABELS, CLIENT_STATUS_COLORS,
} from '@/lib/client-model'
import MetricCard from '@/components/ui/metric-card'
import AddClientModal from './AddClientModal'
import ImportClientsModal from './ImportClientsModal'
import PendingScheduleClients from './PendingScheduleClients'
import type { PendingScheduleEventDTO } from '@/lib/actions/schedule'

type SortKey = 'name' | 'createdAt' | 'visitsCount' | 'totalGross' | 'lastVisitDate' | 'type' | 'contact' | 'company' | 'status'

interface ClientRow {
  id: string
  name: string
  type: ClientType
  status: ClientStatus
  phone?: string | null
  telegram?: string | null
  email?: string | null
  companyName?: string | null
  contactPerson?: string | null
  createdAt: string | Date
  visitsCount?: number
  totalHours?: number
  totalGross?: number | null
  lastVisitDate?: string | Date | null
}

function formatMoney(v: number | null | undefined) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

interface Props {
  initialClients: ClientRow[]
  stats: {
    total: number
    active: number
    legal: number
    debt: number
    ok: boolean
  }
  dbConnected: boolean
  pendingScheduleEvents?: PendingScheduleEventDTO[]
}

export default function ClientsSection({ initialClients, stats, dbConnected, pendingScheduleEvents = [] }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<ClientType | 'ALL'>('ALL')
  const [statusFilter, setStatusFilter] = useState<ClientStatus | 'ALL'>('ALL')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return initialClients.filter(c => {
      if (q && ![c.name, c.email, c.phone, c.companyName, c.telegram, c.contactPerson]
          .some(v => v?.toLowerCase().includes(q))) return false
      if (typeFilter !== 'ALL' && c.type !== typeFilter) return false
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false
      return true
    })
  }, [initialClients, search, typeFilter, statusFilter])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name, 'ru')
      if (sortKey === 'createdAt') cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      if (sortKey === 'visitsCount') cmp = (a.visitsCount ?? 0) - (b.visitsCount ?? 0)
      if (sortKey === 'totalGross') cmp = (a.totalGross ?? 0) - (b.totalGross ?? 0)
      if (sortKey === 'lastVisitDate') {
        cmp = (a.lastVisitDate ? new Date(a.lastVisitDate).getTime() : 0) - (b.lastVisitDate ? new Date(b.lastVisitDate).getTime() : 0)
      }
      if (sortKey === 'type') cmp = CLIENT_TYPE_LABELS[a.type].localeCompare(CLIENT_TYPE_LABELS[b.type], 'ru')
      if (sortKey === 'contact') cmp = (a.phone ?? a.telegram ?? '').localeCompare(b.phone ?? b.telegram ?? '', 'ru')
      if (sortKey === 'company') cmp = (a.companyName ?? '').localeCompare(b.companyName ?? '', 'ru')
      if (sortKey === 'status') cmp = CLIENT_STATUS_LABELS[a.status].localeCompare(CLIENT_STATUS_LABELS[b.status], 'ru')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortKey, sortDir])

  function SortBtn({ k, label }: { k: SortKey; label: string }) {
    const isActive = sortKey === k
    return (
      <button onClick={() => toggleSort(k)} className="flex items-center gap-1 hover:text-white transition-colors">
        {label}
        {isActive ? (
          sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
      </button>
    )
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Клиенты</h1>
          <p className="text-zinc-400 text-sm mt-1">База клиентов студии</p>
        </div>
        <div className="flex items-center gap-3">
          <ImportClientsModal onSuccess={() => router.refresh()} />
          <AddClientModal onSuccess={() => router.refresh()} />
        </div>
      </div>

      {/* DB not connected banner */}
      {!dbConnected && (
        <div className="flex items-center gap-3 bg-amber-950/40 border border-amber-800/60 rounded-xl px-4 py-3">
          <WifiOff className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <p className="text-amber-300 text-sm">
            База данных не подключена. Добавьте <code className="bg-amber-900/40 px-1 rounded text-xs">DATABASE_URL</code> в .env.local и запустите{' '}
            <code className="bg-amber-900/40 px-1 rounded text-xs">npx prisma db push</code>.
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: 'Всего',      value: stats.total,  icon: Users,       hint: 'в базе студии' },
          { label: 'Активные',   value: stats.active, icon: UserCheck,   hint: 'текущие или недавние' },
          { label: 'Юрлица',     value: stats.legal,  icon: Building2,   hint: 'требуют документы' },
          { label: 'Долги',      value: stats.debt,   icon: AlertCircle, hint: 'требуют внимания' },
          { label: 'Постоянные', value: initialClients.filter(c => c.status === 'REGULAR').length, icon: Star, hint: 'повторные обращения' },
        ].map(({ label, value, icon: Icon, hint }) => (
          <MetricCard key={label} icon={Icon} label={label} value={String(value)} subtitle={hint} valueClassName="text-3xl" />
        ))}
      </div>

      {pendingScheduleEvents.length > 0 && (
        <PendingScheduleClients events={pendingScheduleEvents} onChanged={() => router.refresh()} />
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по имени, email, телефону, компании..."
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder-zinc-600 text-sm rounded-lg pl-9 pr-3 py-2.5 outline-none focus:border-zinc-600 transition-colors"
          />
        </div>

        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as ClientType | 'ALL')}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer"
        >
          <option value="ALL">Все типы</option>
          <option value="INDIVIDUAL">Физлицо</option>
          <option value="SELF_EMPLOYED">Самозанятый</option>
          <option value="IP">ИП</option>
          <option value="LLC">ООО</option>
          <option value="AGENCY">Агентство</option>
        </select>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as ClientStatus | 'ALL')}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm rounded-lg px-3 py-2.5 outline-none focus:border-zinc-600 cursor-pointer"
        >
          <option value="ALL">Все статусы</option>
          <option value="NEW">Новый</option>
          <option value="ACTIVE">В работе</option>
          <option value="REPEAT">Повторный</option>
          <option value="REGULAR">Постоянный</option>
          <option value="SLEEPING">Спящий</option>
          <option value="PROBLEM">Проблемный</option>
          <option value="ARCHIVED">Архив</option>
        </select>

        {(search || typeFilter !== 'ALL' || statusFilter !== 'ALL') && (
          <button onClick={() => { setSearch(''); setTypeFilter('ALL'); setStatusFilter('ALL') }}
            className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors">
            Сбросить
          </button>
        )}
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
          <Users className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">
            {initialClients.length === 0
              ? dbConnected ? 'Клиентов пока нет — добавьте первого' : 'Подключите базу данных'
              : 'По вашему запросу ничего не найдено'}
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-zinc-400 text-xs uppercase tracking-wider font-medium">
                    <SortBtn k="name" label="Клиент" />
                  </th>
                  <th className="text-left px-4 py-3 text-zinc-400 text-xs uppercase tracking-wider font-medium">
                    <SortBtn k="type" label="Тип" />
                  </th>
                  <th className="text-left px-4 py-3 text-zinc-400 text-xs uppercase tracking-wider font-medium">
                    <SortBtn k="contact" label="Контакт" />
                  </th>
                  <th className="text-left px-4 py-3 text-zinc-400 text-xs uppercase tracking-wider font-medium">
                    <SortBtn k="company" label="Компания" />
                  </th>
                  <th className="text-left px-4 py-3 text-zinc-400 text-xs uppercase tracking-wider font-medium">
                    <SortBtn k="status" label="Статус" />
                  </th>
                  <th className="text-left px-4 py-3 text-zinc-400 text-xs uppercase tracking-wider font-medium">
                    <SortBtn k="visitsCount" label="Визитов" />
                  </th>
                  <th className="text-left px-4 py-3 text-zinc-400 text-xs uppercase tracking-wider font-medium">Часов</th>
                  <th className="text-left px-4 py-3 text-zinc-400 text-xs uppercase tracking-wider font-medium">
                    <SortBtn k="totalGross" label="Потрачено" />
                  </th>
                  <th className="text-left px-4 py-3 text-zinc-400 text-xs uppercase tracking-wider font-medium">
                    <SortBtn k="lastVisitDate" label="Последний визит" />
                  </th>
                  <th className="text-left px-4 py-3 text-zinc-400 text-xs uppercase tracking-wider font-medium">
                    <SortBtn k="createdAt" label="Добавлен" />
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((c, i) => (
                  <tr key={c.id}
                    className={`border-b border-zinc-800/60 hover:bg-zinc-800/40 transition-colors ${i === sorted.length - 1 ? 'border-b-0' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-zinc-100 font-medium">{c.name}</p>
                          {c.email && <p className="text-zinc-500 text-xs mt-0.5">{c.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={`text-xs ${CLIENT_TYPE_COLORS[c.type]}`}>
                        {CLIENT_TYPE_LABELS[c.type]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-0.5">
                        {c.phone && <p className="text-zinc-300 text-xs">{c.phone}</p>}
                        {c.telegram && <p className="text-zinc-400 text-xs">{c.telegram}</p>}
                        {!c.phone && !c.telegram && <p className="text-zinc-600 text-xs">—</p>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-400 text-xs">{c.companyName ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={`text-xs ${CLIENT_STATUS_COLORS[c.status]}`}>
                        {CLIENT_STATUS_LABELS[c.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-300 text-xs">{c.visitsCount ?? 0}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-400 text-xs">{c.totalHours ? c.totalHours.toFixed(1) : '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-300 text-xs">{formatMoney(c.totalGross)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-500 text-xs">
                        {c.lastVisitDate ? new Date(c.lastVisitDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—'}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-500 text-xs">
                        {new Date(c.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/clients/${c.id}`}
                        className="flex items-center justify-center w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors">
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-zinc-800 text-zinc-500 text-xs">
            {sorted.length} из {initialClients.length} клиентов
          </div>
        </div>
      )}
    </div>
  )
}
