import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Mail, Phone, MessageCircle, Calendar, Clock, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  CLIENT_STATUS_LABELS, CLIENT_STATUS_COLORS,
  CLIENT_TYPE_LABELS, CLIENT_TYPE_COLORS,
  CLIENT_SOURCE_LABELS,
} from '@/lib/client-model'
import { getClientById } from '@/lib/actions/clients'
import { getClientSubscriptions } from '@/lib/actions/subscriptions'
import { getClientShootsData, getClientFinanceOverview } from '@/lib/actions/client-shoots'
import { getConversationForClient } from '@/lib/actions/telegram'
import { getMontageProjectsForClient } from '@/lib/actions/montage'
import { getDocumentsForClient } from '@/lib/actions/documents'
import ClientTabs from './ClientTabs'
import EditClientModal from './EditClientModal'
import MergeClientModal from './MergeClientModal'
import ClientTelegramLayout from '@/components/telegram/ClientTelegramLayout'

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

function formatHours(v: number) {
  return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)} ч`
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [result, subscriptionsResult, shootsResult, financeResult, telegramResult, montageResult, documentsResult] = await Promise.all([
    getClientById(id),
    getClientSubscriptions(id),
    getClientShootsData(id),
    getClientFinanceOverview(id),
    getConversationForClient(id),
    getMontageProjectsForClient(id),
    getDocumentsForClient(id),
  ])
  if (!result.ok || !result.data) redirect('/admin/clients')

  const client = result.data
  const initials = client.name.charAt(0).toUpperCase()
  const conversation = telegramResult.ok ? telegramResult.data : null
  const { summary } = shootsResult.data
  const finance = financeResult.data
  // Тот же приём, что и в src/app/(admin)/admin/telegram/[id]/page.tsx —
  // ключ меняется при реальном изменении диалога, чтобы ClientTelegramPanel
  // пересоздавался из свежих данных, а не пытался слить их через useEffect.
  const telegramKey = conversation
    ? `${conversation.updatedAt}:${conversation.messages.length}:${conversation.messages.map(m => m.status).join(',')}`
    : 'no-telegram-dialog'

  return (
    <div className="p-8">
      {/* Back nav */}
      <Link
        href="/admin/clients"
        className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white text-sm transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Клиенты
      </Link>

      {/* Двухколоночный layout: слева карточка клиента (обычный скролл
          страницы), справа Telegram-диалог — sticky и с собственным скроллом
          в пределах экрана. Само сворачивание/разворачивание правой панели
          (+ персистентность в localStorage) живёт в ClientTelegramLayout —
          это клиентский компонент, а вся левая колонка ниже остаётся
          обычным серверным рендерингом, переданным туда как children.
          key={client.id} — переход из карточки клиента A в карточку клиента B
          (тот же маршрут-шаблон [id], меняется только параметр) не обязан
          пересоздавать компонент сам по себе; без явного key стейт
          "свёрнуто/развёрнуто" от клиента A мог бы на мгновение перенестись
          на B до срабатывания эффекта чтения localStorage. */}
      <ClientTelegramLayout
        key={client.id}
        clientId={client.id}
        clientName={client.name}
        conversation={conversation}
        telegramKey={telegramKey}
      >
          {/* Header card — компактный: аватар меньше, единый вертикальный
              ритм (mt-1.5 везде вместо разнобоя mt-2/mt-3), кнопки справа
              всегда в один ряд с именем и не ломают его благодаря min-w-0
              на текстовом блоке. */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-12 h-12 rounded-full bg-zinc-700 flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
                  {initials}
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg font-bold text-white truncate">{client.name}</h1>
                  {client.companyName && (
                    <p className="text-zinc-400 text-sm mt-0.5 truncate">{client.companyName}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <Badge variant="outline" className={`text-xs ${CLIENT_TYPE_COLORS[client.type as keyof typeof CLIENT_TYPE_COLORS]}`}>
                      {CLIENT_TYPE_LABELS[client.type as keyof typeof CLIENT_TYPE_LABELS]}
                    </Badge>
                    <Badge variant="outline" className={`text-xs ${CLIENT_STATUS_COLORS[client.status as keyof typeof CLIENT_STATUS_COLORS]}`}>
                      {CLIENT_STATUS_LABELS[client.status as keyof typeof CLIENT_STATUS_LABELS]}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <MergeClientModal clientId={client.id} clientName={client.name} />
                <EditClientModal client={client} />
              </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 pt-4 border-t border-zinc-800">
              {client.email && (
                <span className="flex items-center gap-1.5 text-zinc-400 text-sm">
                  <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                  {client.email}
                </span>
              )}
              {client.phone && (
                <span className="flex items-center gap-1.5 text-zinc-400 text-sm">
                  <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                  {client.phone}
                </span>
              )}
              {client.telegram && (
                <span className="flex items-center gap-1.5 text-zinc-400 text-sm">
                  <MessageCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  {client.telegram}
                </span>
              )}
              <span className="flex items-center gap-1.5 text-zinc-400 text-sm">
                <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                добавлен {new Date(client.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
            </div>
          </div>

          {/* Summary stats — единый масштаб (label сверху, значение снизу).
              text-lg, а не text-xl: на тексте "Заметок"/"Контактов" разница
              незаметна, но у "Источник" значение — слово (например,
              "Telegram"), а не цифра, и на text-xl bold оно и визуально
              "тяжелее" соседних однозначных чисел, и физически не всегда
              помещается в карточку той же ширины (при ~1280-1440px реально
              обрезалось в "Telegra…" несмотря на truncate). text-lg решает
              оба: одинаковый вес во всём ряду, честно помещается. title=
              на самой карточке — полное значение видно по наведению, если
              когда-нибудь встретится более длинный источник. Ни одна
              карточка не кликабельна — намеренно без hover/cursor-pointer. */}
          {/* Два заметных итоговых показателя — часы и деньги, посчитанные
              сервером один раз (getClientShootsData/getClientFinanceOverview)
              из единого списка "Съёмки", без двойного учёта абонементов и
              разовых оплат (см. итоговый отчёт). Отдельная строка над мелкими
              мета-карточками ниже, чтобы не теряться на их фоне. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-zinc-400 text-xs uppercase tracking-wider">Всего часов в студии</p>
                <div className="w-8 h-8 bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 text-zinc-300" />
                </div>
              </div>
              <p className="text-white text-2xl font-bold">{formatHours(summary.totalHours)}</p>
              <p className="text-zinc-500 text-xs mt-1">
                {summary.totalShoots} {summary.totalShoots === 1 ? 'съёмка' : 'съёмок'}
                {summary.lastShootDate && ` · последняя ${new Date(summary.lastShootDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`}
              </p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-zinc-400 text-xs uppercase tracking-wider">Всего оплачено</p>
                <div className="w-8 h-8 bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Wallet className="w-4 h-4 text-zinc-300" />
                </div>
              </div>
              <p className="text-white text-2xl font-bold">{formatMoney(finance.netReceived)}</p>
              <p className="text-zinc-500 text-xs mt-1">
                {finance.refundsTotal > 0
                  ? `из них возвращено ${formatMoney(finance.refundsTotal)}`
                  : summary.avgCheck != null ? `средний чек ${formatMoney(summary.avgCheck)}` : 'нет данных об оплатах'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex flex-col justify-center gap-0.5 h-[72px]">
              <p className="text-zinc-500 text-[11px] uppercase tracking-wide">Заметок</p>
              <p className="text-white text-lg font-semibold">{client.clientNotes.length}</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex flex-col justify-center gap-0.5 h-[72px]">
              <p className="text-zinc-500 text-[11px] uppercase tracking-wide">Контактов</p>
              <p className="text-white text-lg font-semibold">{client.contacts.length}</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex flex-col justify-center gap-0.5 h-[72px]">
              <p className="text-zinc-500 text-[11px] uppercase tracking-wide">Документов</p>
              <p className="text-white text-lg font-semibold">{documentsResult.data.length}</p>
            </div>
            <div
              className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3.5 flex flex-col justify-center gap-0.5 h-[72px]"
              title={client.source ? CLIENT_SOURCE_LABELS[client.source as keyof typeof CLIENT_SOURCE_LABELS] : undefined}
            >
              <p className="text-zinc-500 text-[11px] uppercase tracking-wide">Источник</p>
              <p className="text-white text-lg font-semibold truncate">
                {client.source ? CLIENT_SOURCE_LABELS[client.source as keyof typeof CLIENT_SOURCE_LABELS] : '—'}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <ClientTabs
            client={client}
            subscriptions={subscriptionsResult.data}
            shoots={shootsResult.data.shoots}
            shootsSummary={shootsResult.data.summary}
            financeOverview={finance}
            montageProjects={montageResult.data}
            documents={documentsResult.data}
          />
      </ClientTelegramLayout>
    </div>
  )
}
