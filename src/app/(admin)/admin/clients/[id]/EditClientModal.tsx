'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Edit2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { updateClient, type UpdateClientInput } from '@/lib/actions/clients'
import {
  CLIENT_TYPE_LABELS, CLIENT_STATUS_LABELS, CLIENT_SOURCE_LABELS,
  type ClientType, type ClientStatus, type ClientSource,
} from '@/lib/client-model'

interface ClientData {
  id: string
  name: string
  firstName?: string | null
  lastName?: string | null
  patronymic?: string | null
  workplace?: string | null
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
}

interface Props {
  client: ClientData
}

const INPUT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors'
const SELECT = 'w-full bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#00c26b] transition-colors cursor-pointer'
const LABEL = 'block text-zinc-400 text-xs mb-1.5'
const SECTION = 'text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-3 mt-5 first:mt-0 pt-4 border-t border-zinc-800/80 first:border-0 first:pt-0'

export default function EditClientModal({ client }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<UpdateClientInput>({
    firstName: client.firstName ?? '',
    lastName: client.lastName ?? '',
    patronymic: client.patronymic ?? '',
    workplace: client.workplace ?? '',
    type: client.type as ClientType,
    status: client.status as ClientStatus,
    source: (client.source ?? null) as ClientSource | null,
    customSource: client.customSource ?? '',
    contactPerson: client.contactPerson ?? '',
    phone: client.phone ?? '',
    telegram: client.telegram ?? '',
    email: client.email ?? '',
    companyName: client.companyName ?? '',
    inn: client.inn ?? '',
    kpp: client.kpp ?? '',
    ogrn: client.ogrn ?? '',
    legalAddress: client.legalAddress ?? '',
    documentComment: client.documentComment ?? '',
    notes: client.notes ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof UpdateClientInput>(k: K, v: UpdateClientInput[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.firstName?.trim()) return
    setLoading(true)
    setError(null)
    const result = await updateClient(client.id, form)
    setLoading(false)
    if (result.ok) {
      setOpen(false)
      router.refresh()
    } else {
      setError(result.error ?? 'Ошибка сохранения')
    }
  }

  const isLegal = form.type !== 'INDIVIDUAL' && form.type !== 'SELF_EMPLOYED'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm px-3 py-2 rounded-lg transition-colors">
        <Edit2 className="w-3.5 h-3.5" />
        Редактировать
      </DialogTrigger>

      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-lg max-h-[88vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800 flex-shrink-0">
          <DialogTitle className="text-white text-lg font-semibold">Редактировать клиента</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">

            <p className={SECTION}>Основное</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Фамилия</label>
                <input className={INPUT} placeholder="Иванов" value={form.lastName ?? ''}
                  onChange={e => set('lastName', e.target.value)} />
              </div>
              <div>
                <label className={LABEL}>Имя <span className="text-red-400">*</span></label>
                <input className={INPUT} placeholder="Иван" value={form.firstName ?? ''}
                  onChange={e => set('firstName', e.target.value)} required />
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
                <select className={SELECT} value={form.type ?? 'INDIVIDUAL'}
                  onChange={e => set('type', e.target.value as ClientType)}>
                  {(Object.keys(CLIENT_TYPE_LABELS) as ClientType[]).map(k => (
                    <option key={k} value={k}>{CLIENT_TYPE_LABELS[k]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL}>Статус</label>
                <select className={SELECT} value={form.status ?? 'NEW'}
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

            {error && (
              <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
            <button type="submit" disabled={loading}
              className="flex-1 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors">
              {loading ? 'Сохранение...' : 'Сохранить изменения'}
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
