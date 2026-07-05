'use client'

import { useEffect, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import type { TelegramConversationDetailDTO } from '@/lib/actions/telegram'
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
      <div className="w-full flex-1 min-w-0 space-y-6">{children}</div>

      {collapsed ? (
        <button
          type="button"
          onClick={() => setAndPersist(false)}
          title="Показать Telegram"
          className="w-full xl:w-12 flex-shrink-0 xl:sticky xl:top-8 xl:h-[calc(100vh-4rem)] flex xl:flex-col items-center justify-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 hover:text-[#00c26b] hover:border-zinc-700 transition-colors py-3 xl:py-0"
        >
          <MessageCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-medium xl:text-[11px] xl:font-semibold xl:[writing-mode:vertical-rl] xl:tracking-wide">
            Показать Telegram
          </span>
        </button>
      ) : (
        <div className="w-full xl:w-[clamp(420px,40vw,680px)] flex-shrink-0 xl:sticky xl:top-8 xl:h-[calc(100vh-4rem)]">
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
