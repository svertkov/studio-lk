'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'
export type AutosaveResult = { ok: true } | { ok: false; error: string }

interface UseAutosaveOptions<T> {
  value: T
  onSave: (value: T) => Promise<AutosaveResult>
  // 1.5–2.5с по ТЗ — достаточно, чтобы не слать запрос на каждый символ, но
  // не настолько долго, чтобы черновик заметно отставал от печати.
  debounceMs?: number
  // false — временно приостанавливает и дебаунс-тики, и синхронизацию с
  // localStorage (например, пока идёт явное сохранение по кнопке или пока не
  // выполнены обязательные условия для сохранения этой карточки).
  enabled: boolean
  // null — черновик пока негде хранить (например, у совсем нового заказа ещё
  // нет id, см. use-autosave-draft.ts) — тогда локальная резервная копия не
  // пишется, но flush() всё равно продолжает работать для явного "Сохранить".
  storageKey: string | null
}

interface UseAutosaveResult {
  status: AutosaveStatus
  error: string | null
  // Отменяет ожидающий дебаунс-таймер и сохраняет немедленно — используется
  // и явной кнопкой "Сохранить", и точками принудительного сохранения перед
  // уходом из карточки (см. FLUSH_BEFORE_NAVIGATE в компонентах).
  flush: () => Promise<AutosaveResult>
}

function readDraftRaw(storageKey: string): string | null {
  try { return localStorage.getItem(storageKey) } catch { return null }
}
function writeDraftRaw(storageKey: string, raw: string): void {
  try { localStorage.setItem(storageKey, raw) } catch { /* quota/приватный режим — просто теряем резервную копию */ }
}
function removeDraftRaw(storageKey: string): void {
  try { localStorage.removeItem(storageKey) } catch { /* уже могло не быть */ }
}

export interface StoredDraft<T> {
  value: T
  updatedAt: string
}

// Читает локальный черновик БЕЗ подписки на изменения — вызывается один раз
// при открытии карточки (см. SubscriptionAdjustment-подобный "прочитать один
// раз при монтировании" паттерн), не хук сам по себе, чтобы не тянуть
// дополнительный ререндер только ради самой первой проверки.
export function readAutosaveDraft<T>(storageKey: string): StoredDraft<T> | null {
  const raw = readDraftRaw(storageKey)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredDraft<T>
  } catch {
    return null
  }
}

export function clearAutosaveDraft(storageKey: string): void {
  removeDraftRaw(storageKey)
}

// Надёжное автосохранение карточки заказа — см. AGENTS.md/план: пишет прямо
// в реальную запись (никакой отдельной "черновик"-сущности), локальная копия
// в localStorage защищает от перезагрузки/краша между сетевыми тиками.
// Дебаунс на обычные изменения, но flush() можно вызвать в любой момент
// (открытие связанного клиента/счёта, закрытие карточки, beforeunload).
export function useAutosave<T>({ value, onSave, debounceMs = 2000, enabled, storageKey }: UseAutosaveOptions<T>): UseAutosaveResult {
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  // Обновление рефов вынесено в эффект — react-hooks/refs (используемый в
  // этом проекте линтер) не разрешает мутировать ref прямо в теле рендера.
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])
  const onSaveRef = useRef(onSave)
  useEffect(() => { onSaveRef.current = onSave }, [onSave])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  // Baseline "уже сохранено" — инициализируется текущим значением при монтировании,
  // чтобы самый первый рендер (открытие уже существующей карточки) не считался
  // "изменением" и не запускал автосохранение на пустом месте.
  const lastSavedSerialized = useRef<string>(JSON.stringify(value))

  const performSave = useCallback(async (): Promise<AutosaveResult> => {
    if (savingRef.current) return { ok: true }
    savingRef.current = true
    setStatus('saving')
    const result = await onSaveRef.current(valueRef.current)
    savingRef.current = false
    if (result.ok) {
      lastSavedSerialized.current = JSON.stringify(valueRef.current)
      setStatus('saved')
      setError(null)
      if (storageKey) clearAutosaveDraft(storageKey)
      setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 2000)
    } else {
      setStatus('error')
      setError(result.error)
    }
    return result
  }, [storageKey])

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    return performSave()
  }, [performSave])

  useEffect(() => {
    if (!enabled) return
    const serialized = JSON.stringify(value)
    if (serialized === lastSavedSerialized.current) return

    if (storageKey) writeDraftRaw(storageKey, JSON.stringify({ value, updatedAt: new Date().toISOString() }))
    setStatus('pending')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { timerRef.current = null; performSave() }, debounceMs)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled, debounceMs, storageKey])

  // beforeunload — нельзя надёжно дождаться сети, поэтому лучшее, что можно
  // сделать: отменить таймер и отправить запрос без ожидания (localStorage
  // уже синхронно обновлён на каждое изменение выше — это и есть реальная
  // защита от потери данных при закрытии вкладки, а не сам факт запроса).
  useEffect(() => {
    function handleBeforeUnload() {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
        void performSave()
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [performSave])

  return { status, error, flush }
}
