'use client'

import { useEffect, useState } from 'react'
import { Send, ChevronRight } from 'lucide-react'
import type { TelegramConversationDetailDTO } from '@/lib/actions/telegram'
import { computeChatPriority, CHAT_PRIORITY_LABELS } from '@/lib/telegram-model'
import ClientTelegramPanel from './ClientTelegramPanel'

const STORAGE_KEY = 'studio-lk:client-telegram-panel-collapsed'

interface Props {
  // Левая колонка карточки клиента (шапка/статистика/вкладки) приходит как
  // children из серверного page.tsx — сама эта обёртка клиентская только
  // ради состояния "свёрнуто/развёрнуто", не ради рендеринга левой части.
  children: React.ReactNode
  clientId: string
  clientName: string
  conversation: TelegramConversationDetailDTO | null
  telegramKey: string
}

// Компактная карточка-кнопка вместо старой вертикальной плашки с повёрнутым
// текстом — рендерится ВНУТРИ основной (левой) колонки, а не отдельной узкой
// колонкой справа, поэтому при сворачивании левая колонка честно занимает всю
// ширину (см. ТЗ п.7), а не оставляет пустую полосу под бывшую панель. Статус
// в подписи — тот же computeChatPriority(), что и везде в Telegram-модуле
// (список /admin/telegram, шапка открытого диалога) — чтобы не заводить для
// одной карточки ещё один, отдельный словарь статусов.
function TelegramCollapsedCard({ conversation, onExpand }: { conversation: TelegramConversationDetailDTO | null; onExpand: () => void }) {
  const priority = conversation
    ? computeChatPriority({
        conversationStatus: conversation.status,
        unreadCount: conversation.unreadCount,
        linkedClientId: conversation.linkedClientId,
        orderId: conversation.orderId,
        lastMessageAt: conversation.lastMessageAt,
      })
    : null

  const statusText = !conversation
    ? 'Диалог не связан'
    : priority && priority !== 'normal'
      ? CHAT_PRIORITY_LABELS[priority]
      : 'Открыть переписку'

  return (
    <button
      type="button"
      onClick={onExpand}
      title="Показать Telegram"
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-blue-500/35 bg-gradient-to-br from-blue-500/10 to-blue-500/[0.03] shadow-[0_0_24px_rgba(59,130,246,0.08)] hover:from-blue-500/[0.16] hover:to-blue-500/[0.06] hover:border-blue-500/55 hover:-translate-y-px transition-all text-left"
    >
      <div className="w-9 h-9 rounded-full bg-blue-500/15 border border-blue-500/40 flex items-center justify-center flex-shrink-0">
        <Send className="w-4 h-4 text-blue-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-white text-sm font-semibold">Telegram</p>
        <p className={`text-xs truncate ${priority === 'needs_reply' ? 'text-red-400 font-medium' : 'text-zinc-400'}`}>
          {statusText}
        </p>
      </div>
      {conversation && conversation.unreadCount > 0 && (
        <span className="bg-[#00c26b] text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center flex-shrink-0">
          {conversation.unreadCount}
        </span>
      )}
      <ChevronRight className="w-4 h-4 text-zinc-500 flex-shrink-0" />
    </button>
  )
}

// Двухколоночный layout карточки клиента + состояние "свёрнута ли Telegram-
// панель", персистентное в localStorage (переживает переходы между
// страницами CRM, не переживает только чистку данных браузера — этого
// достаточно для "не сбрасывалось постоянно" из ТЗ, не требует cookie/БД).
export default function ClientTelegramLayout({ children, clientId, clientName, conversation, telegramKey }: Props) {
  const [collapsed, setCollapsed] = useState(false)

  // Читаем localStorage только после монтирования — на сервере его нет, а
  // синхронное чтение при первом рендере рискует разойтись с SSR-разметкой
  // (hydration mismatch). Короткая "вспышка" развёрнутого состояния до этого
  // эффекта — стандартный и принятый компромисс для localStorage-стейта в SSR.
  // setState отложен через setTimeout(…, 0) — react-hooks/set-state-in-effect
  // не разрешает синхронный setState в теле эффекта (см. память проекта).
  useEffect(() => {
    const timer = setTimeout(() => setCollapsed(localStorage.getItem(STORAGE_KEY) === '1'), 0)
    return () => clearTimeout(timer)
  }, [])

  function setAndPersist(next: boolean) {
    setCollapsed(next)
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
  }

  return (
    <div className="mt-6 flex flex-col xl:flex-row gap-6 items-start">
      <div className="w-full flex-1 min-w-0 space-y-6">
        {collapsed && <TelegramCollapsedCard conversation={conversation} onExpand={() => setAndPersist(false)} />}
        {children}
      </div>

      {/* Ограничение по высоте раньше применялось только с xl: — ниже этой
          ширины экрана колонки идут одна под другой (flex-col), и панель без
          какого-либо h-* совсем не имела границы: росла вместе с историей
          сообщений, и поле ввода оказывалось на дно страницы, требуя
          прокрутки всей карточки клиента, а не только истории сообщений
          внутри Telegram-блока (см. ТЗ п.1). Теперь базовый h-[600px] задан
          без брейкпоинта — работает и на узких/средних экранах; xl:-версия
          переопределяет его на sticky + высоту, привязанную к вьюпорту. */}
      {!collapsed && (
        <div className="w-full xl:w-[clamp(420px,40vw,680px)] flex-shrink-0 h-[600px] xl:h-[calc(100vh-4rem)] xl:sticky xl:top-8">
          <ClientTelegramPanel
            key={telegramKey}
            clientId={clientId}
            clientName={clientName}
            conversation={conversation}
            onCollapse={() => setAndPersist(true)}
          />
        </div>
      )}
    </div>
  )
}
