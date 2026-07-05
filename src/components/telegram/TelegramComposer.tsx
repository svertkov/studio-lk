'use client'

import { useRef, useState } from 'react'
import { upload } from '@vercel/blob/client'
import { Send, Paperclip, X, FileText, Loader2 } from 'lucide-react'
import { sendConversationMessage, sendConversationAttachmentFromBlob } from '@/lib/actions/telegram'
import { formatFileSize } from '@/lib/telegram-ui-utils'

const MAX_UPLOAD_MB = 50

// Полностью самодостаточный композер — сам владеет своим состоянием отправки
// текста/вложения и сам вызывает server actions. Используется и в полном
// разделе Telegram, и во встроенной панели внутри карточки клиента: обоим
// достаточно передать conversationId и колбэк onSent (обычно router.refresh()),
// не прокидывая десяток отдельных пропов состояния.
interface TelegramComposerProps {
  conversationId: string
  onSent: () => void
  compact?: boolean
}

export default function TelegramComposer({ conversationId, onSent, compact = false }: TelegramComposerProps) {
  const [messageText, setMessageText] = useState('')
  const [sending, setSending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Вложение — свой небольшой стейт-машин, отдельный от текстовой отправки:
  // idle (ничего не прикреплено) → staged (файл выбран, ждём отправки) →
  // uploading (реальная загрузка байтов на наш сервер, есть процент) →
  // processing (байты уже у нас, ждём ответ от Telegram) → error.
  type AttachmentPhase = 'idle' | 'staged' | 'uploading' | 'processing' | 'error'
  const [stagedFile, setStagedFile] = useState<File | null>(null)
  const [attachmentPhase, setAttachmentPhase] = useState<AttachmentPhase>('idle')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Реальный прогресс — через upload() из @vercel/blob/client (onUploadProgress
  // считает по фактическим байтам, не фейковый таймер). Файл уходит напрямую
  // из браузера в Vercel Blob, а не в нашу serverless-функцию: у функций
  // Vercel жёсткий лимит тела запроса 4.5 МБ (см. память проекта) — при видео/
  // больших файлах без Blob запрос падал с 413/500 ещё до нашего кода. После
  // загрузки в Blob сервер забирает байты оттуда и пересылает в Telegram
  // (sendConversationAttachmentFromBlob), а сам blob сразу удаляется.
  async function uploadStagedFile(file: File): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
    const controller = new AbortController()
    uploadAbortRef.current = controller
    try {
      const blob = await upload(`telegram/${conversationId}/${Date.now()}-${file.name}`, file, {
        access: 'private',
        handleUploadUrl: '/api/telegram/blob-upload',
        contentType: file.type || undefined,
        abortSignal: controller.signal,
        onUploadProgress: ({ percentage }) => setUploadProgress(Math.round(percentage)),
      })
      return { ok: true, url: blob.url }
    } catch (e) {
      if (controller.signal.aborted) return { ok: false, error: 'Загрузка отменена' }
      return { ok: false, error: e instanceof Error ? e.message : 'Не удалось загрузить файл' }
    } finally {
      uploadAbortRef.current = null
    }
  }

  async function handleSend() {
    if (sending || attachmentPhase === 'uploading' || attachmentPhase === 'processing') return
    const text = messageText.trim()

    if (stagedFile) {
      setAttachmentPhase('uploading')
      setUploadProgress(0)
      setAttachmentError(null)
      const uploadResult = await uploadStagedFile(stagedFile)
      if (!uploadResult.ok) {
        setAttachmentPhase('error')
        setAttachmentError(uploadResult.error)
        return
      }

      // Байты уже в Blob — дальше сервер сам читает их оттуда и шлёт в
      // Telegram; с клиента тут прогресс отслеживать больше нечем.
      setAttachmentPhase('processing')
      const sendResult = await sendConversationAttachmentFromBlob(conversationId, {
        blobUrl: uploadResult.url,
        fileName: stagedFile.name,
        mimeType: stagedFile.type || 'application/octet-stream',
        caption: text || undefined,
      })
      if (sendResult.ok) {
        setStagedFile(null)
        setAttachmentPhase('idle')
        setUploadProgress(0)
        setMessageText('')
        onSent()
      } else {
        setAttachmentPhase('error')
        setAttachmentError(sendResult.error)
      }
      return
    }

    if (!text) return
    setSending(true)
    setMessageText('')
    const result = await sendConversationMessage(conversationId, text)
    setSending(false)
    if (!result.ok) setActionError(result.error)
    onSent()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function stageFile(file: File) {
    setUploadProgress(0)
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setStagedFile(file)
      setAttachmentPhase('error')
      setAttachmentError(`Файл больше ${MAX_UPLOAD_MB} МБ — Telegram не примет его от бота`)
      return
    }
    setStagedFile(file)
    setAttachmentPhase('staged')
    setAttachmentError(null)
  }

  function handleRemoveStagedFile() {
    if (attachmentPhase === 'uploading') uploadAbortRef.current?.abort()
    setStagedFile(null)
    setAttachmentPhase('idle')
    setUploadProgress(0)
    setAttachmentError(null)
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) stageFile(file)
    e.target.value = '' // чтобы повторный выбор того же файла тоже сработал
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDraggingOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDraggingOver(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDraggingOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) stageFile(file)
  }

  return (
    <div
      className="border-t border-zinc-800 flex-shrink-0 relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingOver && (
        <div className="absolute inset-0 z-10 bg-[#00c26b]/10 border-2 border-dashed border-[#00c26b]/60 rounded-lg flex items-center justify-center pointer-events-none">
          <p className="text-[#00c26b] font-medium text-sm">Отпустите файл, чтобы прикрепить</p>
        </div>
      )}

      {actionError && (
        <p className="mx-4 sm:mx-6 mt-3 text-red-400 text-xs bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">{actionError}</p>
      )}

      {stagedFile && (
        <div className="mx-4 sm:mx-6 mt-3 bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-zinc-400 flex-shrink-0" />
            <p className="text-zinc-200 text-xs truncate flex-1 min-w-0">{stagedFile.name}</p>
            <p className="text-zinc-500 text-[11px] flex-shrink-0">{formatFileSize(stagedFile.size)}</p>
            <button type="button" onClick={handleRemoveStagedFile} title="Убрать файл" className="text-zinc-500 hover:text-zinc-200 flex-shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {attachmentPhase === 'uploading' && (
            <div className="space-y-1">
              <div className="h-1 bg-zinc-700 rounded-full overflow-hidden">
                <div className="h-full bg-[#00c26b] transition-[width] duration-150" style={{ width: `${uploadProgress}%` }} />
              </div>
              <p className="text-zinc-500 text-[11px]">Загрузка: {uploadProgress}%</p>
            </div>
          )}
          {attachmentPhase === 'processing' && (
            <p className="text-zinc-500 text-[11px] flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Отправка в Telegram...
            </p>
          )}
          {attachmentPhase === 'staged' && (
            <p className="text-zinc-500 text-[11px]">Готово к отправке</p>
          )}
          {attachmentPhase === 'error' && (
            <p className="text-red-400 text-[11px]">Ошибка загрузки{attachmentError ? `: ${attachmentError}` : ''}</p>
          )}
        </div>
      )}

      <div className={`flex items-center gap-2 ${compact ? 'px-3 py-2.5' : 'px-4 sm:px-6 py-3 sm:gap-3'}`}>
        <input ref={fileInputRef} type="file" hidden onChange={handleFileInputChange} />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={attachmentPhase === 'uploading' || attachmentPhase === 'processing'}
          title="Прикрепить файл"
          className="text-zinc-400 hover:text-zinc-200 disabled:opacity-40 p-2.5 rounded-full flex-shrink-0 transition-colors hover:bg-zinc-800"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <textarea
          value={messageText}
          onChange={e => setMessageText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={stagedFile ? 'Подпись к файлу (необязательно)...' : 'Написать сообщение...'}
          rows={compact ? 1 : 2}
          className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors resize-none"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || attachmentPhase === 'uploading' || attachmentPhase === 'processing' || (!messageText.trim() && !stagedFile)}
          title="Отправить"
          className="bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white w-9 h-9 flex items-center justify-center rounded-full transition-colors flex-shrink-0"
        >
          {attachmentPhase === 'uploading' || attachmentPhase === 'processing' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  )
}
