'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShoppingBag, Film, DollarSign, FileText, HardDrive, Upload, Send, Calendar } from 'lucide-react'
import {
  CLIENT_TYPE_LABELS, CLIENT_STATUS_LABELS, CLIENT_SOURCE_LABELS,
} from '@/lib/client-model'
import { addClientNote } from '@/lib/actions/clients'

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
}

interface Props {
  client: PrismaClient
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

export default function ClientTabs({ client }: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('overview')
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  const isLegal = client.type !== 'INDIVIDUAL' && client.type !== 'SELF_EMPLOYED'

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
          <PlaceholderTab
            icon={Calendar}
            title="Съёмки клиента"
            description="Здесь будет история и расписание съёмок этого клиента"
          />
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
          <PlaceholderTab
            icon={DollarSign}
            title="Финансы клиента"
            description="История оплат, задолженности, счета и акты по этому клиенту"
          />
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
