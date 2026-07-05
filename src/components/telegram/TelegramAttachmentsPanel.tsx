'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { FileText, Search, Link as LinkIcon, Video, Image as ImageIcon, ImageOff } from 'lucide-react'
import type { TelegramSenderType, TelegramMessageType } from '@prisma/client'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { getConversationAttachments, type ConversationAttachmentItemDTO, type AttachmentCategory } from '@/lib/actions/telegram'
import { formatFileSize, formatDuration, getUrlDomain } from '@/lib/telegram-ui-utils'
import Lightbox from './Lightbox'

interface Props {
  conversationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  dialogName: string
  // Закрывает панель и просит родителя проскроллить/подсветить сообщение в
  // чате — сам родитель решает, где именно этот чат отрисован (полный раздел
  // Telegram или встроенная панель в карточке клиента), см. messageId у
  // каждого вложения (архитектурно заложено для этого перехода).
  onShowInChat: (messageId: string) => void
}

type TabId = 'all' | AttachmentCategory

const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'media', label: 'Медиа' },
  { id: 'document', label: 'Документы' },
  { id: 'link', label: 'Ссылки' },
  { id: 'voice', label: 'Голосовые' },
  { id: 'video_note', label: 'Кружочки' },
]

function senderLabelFor(senderType: TelegramSenderType, senderName: string | null): string {
  if (senderType === 'ADMIN') return senderName ? `Админ · ${senderName}` : 'Администратор'
  if (senderType === 'CLIENT') return 'Клиент'
  if (senderType === 'BOT') return 'Бот'
  return 'Система'
}

function mediaLabel(t?: TelegramMessageType): string {
  if (t === 'VIDEO') return '🎬 Видео'
  if (t === 'STICKER') return '🎭 Стикер'
  return '📷 Фото'
}

export default function TelegramAttachmentsPanel({ conversationId, open, onOpenChange, dialogName, onShowInChat }: Props) {
  // Нет отдельного "loading" состояния — производный флаг items === null (и
  // ошибки нет) достаточен: до первого успешного ответа список ещё null,
  // после ошибки он тоже остаётся null, пока не сработает повтор.
  const [items, setItems] = useState<ConversationAttachmentItemDTO[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('all')
  const [search, setSearch] = useState('')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const loading = items === null && !error

  // Кнопка "Повторить" — обычный обработчик клика, setState тут ничем не
  // ограничен (в отличие от эффекта ниже).
  function load() {
    setError(null)
    getConversationAttachments(conversationId).then(result => {
      if (result.ok) setItems(result.data)
      else setError(result.error)
    })
  }

  // Загружаем только когда панель реально открыта — не тянем вложения
  // заранее при каждом рендере страницы (см. часть 13 ТЗ, производительность).
  // setState намеренно вызывается только внутри .then() (то есть уже после
  // возврата из синхронной части эффекта), а не прямым вызовом load() —
  // иначе react-hooks/set-state-in-effect ругается на синхронный setState
  // внутри эффекта (setError/setLoading в load() выполнились бы сразу).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    getConversationAttachments(conversationId).then(result => {
      if (cancelled) return
      if (result.ok) setItems(result.data)
      else setError(result.error)
    })
    return () => { cancelled = true }
  }, [open, conversationId])

  const counts = useMemo(() => {
    const c: Record<AttachmentCategory, number> = { media: 0, document: 0, voice: 0, video_note: 0, link: 0 }
    for (const item of items ?? []) c[item.category]++
    return c
  }, [items])

  const filtered = useMemo(() => {
    if (!items) return []
    let list = tab === 'all' ? items : items.filter(i => i.category === tab)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(i =>
        (i.fileName ?? '').toLowerCase().includes(q) ||
        (i.messageSnippet ?? '').toLowerCase().includes(q) ||
        (i.url ?? '').toLowerCase().includes(q) ||
        (i.mimeType ?? '').toLowerCase().includes(q),
      )
    }
    return list
  }, [items, tab, search])

  function handleShowInChat(messageId: string) {
    onOpenChange(false)
    onShowInChat(messageId)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="bg-zinc-900 border-zinc-800 text-white w-full sm:max-w-xl flex flex-col p-0 gap-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b border-zinc-800 flex-shrink-0">
            <SheetTitle className="text-white text-lg font-semibold">Вложения</SheetTitle>
            <p className="text-zinc-500 text-sm">{dialogName}</p>
          </SheetHeader>

          <div className="px-6 pt-4 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск по названию, тексту, ссылке..."
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors"
              />
            </div>
          </div>

          <div className="px-6 pt-3 flex flex-wrap gap-1.5 flex-shrink-0">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                  tab === t.id
                    ? 'bg-[#00c26b]/15 border-[#00c26b]/50 text-[#00c26b]'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
                }`}
              >
                {t.label}{t.id !== 'all' && ` ${counts[t.id]}`}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 mt-1">
            {loading && <p className="text-zinc-500 text-sm text-center py-10">Загружаем вложения…</p>}

            {!loading && error && (
              <div className="text-center py-10 space-y-3">
                <p className="text-red-400 text-sm">Не удалось загрузить вложения</p>
                <button type="button" onClick={load} className="text-xs text-[#00c26b] hover:underline">Повторить</button>
              </div>
            )}

            {!loading && !error && filtered.length === 0 && (
              <p className="text-zinc-600 text-sm text-center py-10">
                {items && items.length === 0 ? 'В этом диалоге пока нет вложений' : 'Ничего не найдено'}
              </p>
            )}

            {!loading && !error && filtered.length > 0 && (
              tab === 'media' ? (
                <MediaGrid items={filtered} onOpen={setLightboxUrl} onShowInChat={handleShowInChat} />
              ) : (
                <AttachmentList items={filtered} onOpen={setLightboxUrl} onShowInChat={handleShowInChat} />
              )
            )}
          </div>
        </SheetContent>
      </Sheet>

      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </>
  )
}

function MediaGrid({ items, onOpen, onShowInChat }: {
  items: ConversationAttachmentItemDTO[]; onOpen: (url: string) => void; onShowInChat: (messageId: string) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(item => (
        <div key={item.id} className="relative group">
          <MediaTile item={item} onOpen={onOpen} />
          <button
            type="button"
            onClick={() => onShowInChat(item.messageId)}
            className="absolute inset-x-0 bottom-0 bg-black/70 text-white text-[10px] py-1 text-center opacity-0 group-hover:opacity-100 transition-opacity rounded-b-lg"
          >
            Показать в чате
          </button>
        </div>
      ))}
    </div>
  )
}

function MediaTile({ item, onOpen }: { item: ConversationAttachmentItemDTO; onOpen: (url: string) => void }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  if (!item.fileUrl) return null

  // Видео не превьюируем (нет генерации превью на сервере) — плашка с
  // иконкой, открывается в новой вкладке нативным видеоплеером браузера.
  if (item.messageType === 'VIDEO') {
    return (
      <a href={item.downloadUrl} target="_blank" rel="noopener noreferrer"
        className="relative flex aspect-square items-center justify-center rounded-lg bg-zinc-800">
        <Video className="w-6 h-6 text-zinc-400" />
        {item.duration != null && (
          <span className="absolute bottom-1 right-1 text-[10px] text-white bg-black/60 rounded px-1">{formatDuration(item.duration)}</span>
        )}
      </a>
    )
  }

  return (
    <button type="button" onClick={() => onOpen(item.fileUrl!)} className="relative block aspect-square w-full rounded-lg overflow-hidden bg-zinc-800">
      {status === 'loading' && <div className="absolute inset-0 animate-pulse bg-zinc-700/50" />}
      {status === 'error' ? (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
          <ImageOff className="w-5 h-5" />
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- прокси-роут, не статичный ассет
        <img
          src={item.fileUrl}
          alt=""
          loading="lazy"
          className={`w-full h-full object-cover ${status === 'loading' ? 'opacity-0' : 'opacity-100'} transition-opacity duration-150`}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
        />
      )}
    </button>
  )
}

function AttachmentList({ items, onOpen, onShowInChat }: {
  items: ConversationAttachmentItemDTO[]; onOpen: (url: string) => void; onShowInChat: (messageId: string) => void
}) {
  return (
    <div className="space-y-2">
      {items.map(item => (
        <AttachmentRow key={item.id} item={item} onOpen={onOpen} onShowInChat={onShowInChat} />
      ))}
    </div>
  )
}

function RowMeta({ dateLabel, senderLabel, messageId, onShowInChat }: {
  dateLabel: string; senderLabel: string; messageId: string; onShowInChat: (messageId: string) => void
}) {
  return (
    <div className="flex items-center gap-2 text-zinc-500 text-[11px]">
      <span>{dateLabel}</span>
      <span>·</span>
      <span>{senderLabel}</span>
      <span>·</span>
      <button type="button" onClick={() => onShowInChat(messageId)} className="text-zinc-400 hover:text-zinc-200 underline">
        Показать в чате
      </button>
    </div>
  )
}

function AttachmentRow({ item, onOpen, onShowInChat }: {
  item: ConversationAttachmentItemDTO; onOpen: (url: string) => void; onShowInChat: (messageId: string) => void
}) {
  const dateLabel = format(parseISO(item.createdAt), 'd MMM yyyy, HH:mm', { locale: ru })
  const senderLabel = senderLabelFor(item.senderType, item.senderName)

  if (item.category === 'link' && item.url) {
    return (
      <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5 space-y-1.5">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[#00c26b] text-sm hover:underline break-all">
          <LinkIcon className="w-3.5 h-3.5 flex-shrink-0" />
          {getUrlDomain(item.url)}
        </a>
        {item.messageSnippet && <p className="text-zinc-400 text-xs line-clamp-2">{item.messageSnippet}</p>}
        <RowMeta dateLabel={dateLabel} senderLabel={senderLabel} messageId={item.messageId} onShowInChat={onShowInChat} />
      </div>
    )
  }

  if (item.category === 'voice') {
    return (
      <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5 space-y-1.5">
        <div className="flex items-center gap-2">
          <audio controls src={item.fileUrl} className="flex-1 h-8" />
          {item.duration != null && <span className="text-zinc-500 text-[11px] flex-shrink-0">{formatDuration(item.duration)}</span>}
        </div>
        <RowMeta dateLabel={dateLabel} senderLabel={senderLabel} messageId={item.messageId} onShowInChat={onShowInChat} />
      </div>
    )
  }

  if (item.category === 'video_note') {
    return (
      <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5 flex items-center gap-3">
        <video src={item.fileUrl} className="w-14 h-14 rounded-full object-cover bg-black flex-shrink-0" muted />
        <div className="min-w-0 flex-1 space-y-1">
          <a href={item.downloadUrl} target="_blank" rel="noopener noreferrer" className="text-zinc-200 text-xs hover:underline">
            Открыть кружочек
          </a>
          <RowMeta dateLabel={dateLabel} senderLabel={senderLabel} messageId={item.messageId} onShowInChat={onShowInChat} />
        </div>
      </div>
    )
  }

  if (item.category === 'document') {
    return (
      <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5 flex items-center gap-3">
        <FileText className="w-5 h-5 text-zinc-400 flex-shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-zinc-200 text-sm truncate">{item.fileName || 'Документ'}</p>
          <p className="text-zinc-500 text-xs">{formatFileSize(item.fileSize)}{item.mimeType ? ` · ${item.mimeType}` : ''}</p>
          <RowMeta dateLabel={dateLabel} senderLabel={senderLabel} messageId={item.messageId} onShowInChat={onShowInChat} />
        </div>
        <a href={item.downloadUrl} className="text-xs text-[#00c26b] hover:underline flex-shrink-0">Скачать</a>
      </div>
    )
  }

  // media (photo/video/sticker), показывается только в смешанной вкладке "Все"
  return (
    <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2.5 flex items-center gap-3">
      {item.messageType === 'PHOTO' && item.fileUrl ? (
        <button type="button" onClick={() => onOpen(item.fileUrl!)} className="w-12 h-12 rounded overflow-hidden bg-zinc-900 flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- прокси-роут, не статичный ассет */}
          <img src={item.fileUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
        </button>
      ) : (
        <div className="w-12 h-12 rounded bg-zinc-900 flex items-center justify-center flex-shrink-0">
          <ImageIcon className="w-5 h-5 text-zinc-500" />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-zinc-300 text-xs">{mediaLabel(item.messageType)}</p>
        <RowMeta dateLabel={dateLabel} senderLabel={senderLabel} messageId={item.messageId} onShowInChat={onShowInChat} />
      </div>
    </div>
  )
}
