'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createClient as createStudioClient, type CreateClientInput } from '@/lib/actions/clients'
import {
  CLIENT_TYPE_LABELS, CLIENT_STATUS_LABELS, CLIENT_SOURCE_LABELS,
  type ClientType, type ClientStatus, type ClientSource,
} from '@/lib/client-model'

interface Props {
  onSuccess: () => void
  initialValues?: Partial<CreateClientInput>
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onCreated?: (client: { id: string; name: string }) => void
  // Переопределяемые заголовок/подзаголовок — нужны для вызова из Telegram-
  // диалога ("Создать клиента из Telegram"), по умолчанию — обычная форма
  // из раздела "Клиенты".
  title?: string
  subtitle?: string
  submitLabel?: string
  // Мелкий серый текст внизу формы — например, технические Telegram User
  // ID/Chat ID, которые не редактируются как обычные поля, но администратору
  // полезно их видеть.
  footerNote?: React.ReactNode
}

const EMPTY: CreateClientInput = {
  firstName: '', lastName: '', patronymic: '', workplace: '',
  type: 'INDIVIDUAL', status: 'NEW', source: null,
  customSource: '', contactPerson: '', phone: '', telegram: '', email: '',
  companyName: '', inn: '', kpp: '', ogrn: '', legalAddress: '',
  documentComment: '', notes: '',
}

// {...EMPTY, ...initialValues} перетирает дефолт значением undefined, если
// initialValues явно содержит ключ со значением undefined (а не просто не
// содержит его) — например, когда вызывающий код пишет `lastName: x ?? undefined`
// для отсутствующего в Telegram поля. Отфильтровываем такие ключи заранее,
// чтобы firstName и т.п. всегда оставались строками, а не undefined.
function withoutUndefined(values?: Partial<CreateClientInput>): Partial<CreateClientInput> {
  if (!values) return {}
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined))
}

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'
const LABEL = 'block text-zinc-400 text-xs mb-1.5'
const SECTION = 'text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-3 mt-5 first:mt-0 pt-4 border-t border-zinc-800/80 first:border-0 first:pt-0'

export default function AddClientModal({
  onSuccess, initialValues, open: openProp, onOpenChange: onOpenChangeProp, onCreated,
  title = 'Новый клиент', subtitle, footerNote, submitLabel = 'Сохранить клиента',
}: Props) {
  const isControlled = openProp !== undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const open = isControlled ? openProp : internalOpen
  const setOpen = isControlled ? (onOpenChangeProp ?? (() => {})) : setInternalOpen

  // Явный undefined в initialValues (например, "поля из Telegram нет") не
  // должен перетирать дефолт из EMPTY через spread — {...EMPTY, key:
  // undefined} даёт undefined, а не ''. Отфильтровываем такие ключи, чтобы
  // firstName/lastName и т.п. оставались строками, а не undefined.
  const [form, setForm] = useState<CreateClientInput>({ ...EMPTY, ...withoutUndefined(initialValues) })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof CreateClientInput>(k: K, v: CreateClientInput[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.firstName.trim()) return
    setLoading(true)
    setError(null)
    const result = await createStudioClient(form)
    setLoading(false)
    if (result.ok) {
      setOpen(false)
      setForm({ ...EMPTY, ...withoutUndefined(initialValues) })
      onSuccess()
      onCreated?.(result.data)
    } else {
      setError(result.error ?? 'Ошибка сохранения')
    }
  }

  const isLegal = form.type !== 'INDIVIDUAL' && form.type !== 'SELF_EMPLOYED'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger className="flex items-center gap-2 bg-[#00c26b] hover:bg-[#00b360] text-white font-semibold text-sm px-4 py-2.5 rounded-lg transition-colors shadow-sm">
          <Plus className="w-4 h-4" />
          Добавить клиента
        </DialogTrigger>
      )}

      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-lg sm:max-w-[589px] max-h-[88vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800 flex-shrink-0">
          <DialogTitle className="text-white text-lg font-semibold">{title}</DialogTitle>
          {subtitle && <p className="text-zinc-500 text-sm mt-0.5">{subtitle}</p>}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">

            <p className={SECTION}>Основное</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Имя <span className="text-red-400">*</span></label>
                <input className={INPUT} placeholder="Иван" value={form.firstName}
                  onChange={e => set('firstName', e.target.value)} required />
              </div>
              <div>
                <label className={LABEL}>Фамилия</label>
                <input className={INPUT} placeholder="Иванов" value={form.lastName ?? ''}
                  onChange={e => set('lastName', e.target.value)} />
              </div>
            </div>
            <div>
              <label className={LABEL}>Отчество</label>
              <input className={INPUT} placeholder="Иванович" value={form.patronymic ?? ''}
                onChange={e => set('patronymic', e.target.value)} />
            </div>
            <div>
              <label className={LABEL}>Компания, в которой работает</label>
              <input className={INPUT} placeholder="Название компании" value={form.workplace ?? ''}
                onChange={e => set('workplace', e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Тип</label>
                <select className={SELECT} value={form.type}
                  onChange={e => set('type', e.target.value as ClientType)}>
                  {(Object.keys(CLIENT_TYPE_LABELS) as ClientType[]).map(k => (
                    <option key={k} value={k}>{CLIENT_TYPE_LABELS[k]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL}>Статус</label>
                <select className={SELECT} value={form.status}
                  onChange={e => set('status', e.target.value as ClientStatus)}>
                  {(Object.keys(CLIENT_STATUS_LABELS) as ClientStatus[]).map(k => (
                    <option key={k} value={k}>{CLIENT_STATUS_LABELS[k]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={LABEL}>Источник</label>
              <select className={SELECT} value={form.source ?? ''}
                onChange={e => set('source', (e.target.value || null) as ClientSource | null)}>
                <option value="">Не указан</option>
                {(Object.keys(CLIENT_SOURCE_LABELS) as ClientSource[]).map(k => (
                  <option key={k} value={k}>{CLIENT_SOURCE_LABELS[k]}</option>
                ))}
              </select>
            </div>

            {form.source === 'OTHER' && (
              <div>
                <label className={LABEL}>Уточните источник</label>
                <input className={INPUT} placeholder="Откуда узнали о студии..." value={form.customSource ?? ''}
                  onChange={e => set('customSource', e.target.value)} />
              </div>
            )}

            <p className={SECTION}>Контакты</p>

            <div>
              <label className={LABEL}>Контактное лицо</label>
              <input className={INPUT} placeholder="Имя (если отличается от названия)" value={form.contactPerson ?? ''}
                onChange={e => set('contactPerson', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Телефон</label>
                <input className={INPUT} placeholder="+7 900 000 00 00" value={form.phone ?? ''}
                  onChange={e => set('phone', e.target.value)} />
              </div>
              <div>
                <label className={LABEL}>Telegram</label>
                <input className={INPUT} placeholder="@username" value={form.telegram ?? ''}
                  onChange={e => set('telegram', e.target.value)} />
              </div>
            </div>
            <div>
              <label className={LABEL}>Email</label>
              <input className={INPUT} type="email" placeholder="email@example.com" value={form.email ?? ''}
                onChange={e => set('email', e.target.value)} />
            </div>

            {isLegal && (
              <>
                <p className={SECTION}>Реквизиты</p>
                <div>
                  <label className={LABEL}>Название компании</label>
                  <input className={INPUT} placeholder={form.type === 'LLC' ? 'ООО «Название»' : 'ИП Фамилия'}
                    value={form.companyName ?? ''} onChange={e => set('companyName', e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>ИНН</label>
                    <input className={INPUT} placeholder="7700000000" value={form.inn ?? ''}
                      onChange={e => set('inn', e.target.value)} />
                  </div>
                  <div>
                    <label className={LABEL}>{form.type === 'LLC' ? 'КПП' : '—'}</label>
                    {form.type === 'LLC'
                      ? <input className={INPUT} placeholder="770000000" value={form.kpp ?? ''}
                          onChange={e => set('kpp', e.target.value)} />
                      : <div className="py-2 text-zinc-600 text-xs">не требуется</div>}
                  </div>
                </div>
                <div>
                  <label className={LABEL}>ОГРН / ОГРНИП</label>
                  <input className={INPUT} placeholder="1007700000000" value={form.ogrn ?? ''}
                    onChange={e => set('ogrn', e.target.value)} />
                </div>
                <div>
                  <label className={LABEL}>Юридический адрес</label>
                  <input className={INPUT} placeholder="г. Москва, ул. ..." value={form.legalAddress ?? ''}
                    onChange={e => set('legalAddress', e.target.value)} />
                </div>
                <div>
                  <label className={LABEL}>Комментарий по документам</label>
                  <input className={INPUT} placeholder="Особенности оформления..." value={form.documentComment ?? ''}
                    onChange={e => set('documentComment', e.target.value)} />
                </div>
              </>
            )}

            <p className={SECTION}>Дополнительно</p>
            <div>
              <label className={LABEL}>Внутренний комментарий</label>
              <textarea className={`${INPUT} resize-none`} rows={3}
                placeholder="Особенности работы с клиентом..."
                value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} />
            </div>

            {footerNote && (
              <p className="text-zinc-600 text-[11px] pt-1">{footerNote}</p>
            )}

            {error && (
              <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
            <button type="submit" disabled={loading || !form.firstName.trim()}
              className="flex-1 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors">
              {loading ? 'Сохранение...' : submitLabel}
            </button>
            <button type="button" onClick={() => setOpen(false)}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">
              Отмена
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
