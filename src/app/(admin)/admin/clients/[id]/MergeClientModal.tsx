'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Merge, Search, AlertTriangle, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { getClients, mergeClients } from '@/lib/actions/clients'

interface ClientOption {
  id: string
  name: string
  phone?: string | null
  companyName?: string | null
}

interface Props {
  clientId: string
  clientName: string
}

export default function MergeClientModal({ clientId, clientName }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ClientOption[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<ClientOption | null>(null)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setQuery('')
    setResults([])
    setSelected(null)
    setError(null)
  }

  async function handleSearch(value: string) {
    setQuery(value)
    setSelected(null)
    if (value.trim().length < 2) { setResults([]); return }
    setSearching(true)
    const res = await getClients({ search: value.trim() })
    setSearching(false)
    if (res.ok) {
      setResults(res.data.filter(c => c.id !== clientId).slice(0, 15))
    }
  }

  async function handleMerge() {
    if (!selected) return
    setMerging(true)
    setError(null)
    const res = await mergeClients(clientId, selected.id)
    setMerging(false)
    if (res.ok) {
      router.push(`/admin/clients/${selected.id}`)
    } else {
      setError(res.error ?? 'Не удалось объединить клиентов')
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm px-3 py-2 rounded-lg transition-colors">
        <Merge className="w-3.5 h-3.5" />
        Объединить с другим клиентом
      </DialogTrigger>

      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-lg max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-zinc-800 flex-shrink-0">
          <DialogTitle className="text-white text-lg font-semibold">Объединить клиента</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <p className="text-zinc-400 text-sm">
            Карточка «<span className="text-zinc-200">{clientName}</span>» будет объединена с выбранным ниже клиентом:
            вся история визитов, документы и заметки перейдут туда, а имя и контакты «{clientName}» сохранятся
            как дополнительный контакт на основной карточке.
          </p>

          <div>
            <label className="block text-zinc-400 text-xs font-medium mb-2">Найти основного клиента</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
              <input
                value={query}
                onChange={e => handleSearch(e.target.value)}
                placeholder="Имя, телефон, компания..."
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-600 rounded-lg pl-9 pr-3 py-2.5 text-sm outline-none focus:border-[#00c26b] transition-colors"
              />
            </div>
          </div>

          {searching && (
            <div className="flex items-center gap-2 text-zinc-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Ищу...
            </div>
          )}

          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <p className="text-zinc-500 text-sm">Ничего не найдено</p>
          )}

          {results.length > 0 && (
            <div className="border border-zinc-800 rounded-lg overflow-hidden divide-y divide-zinc-800">
              {results.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected(c)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                    selected?.id === c.id ? 'bg-[#00c26b]/10' : 'hover:bg-zinc-800/60'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-zinc-100 text-sm truncate">{c.name}</p>
                    <p className="text-zinc-500 text-xs truncate">{c.companyName ?? c.phone ?? '—'}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div className="flex gap-2.5 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-amber-300 text-sm">
                «{clientName}» будет объединён с «{selected.name}» и заархивирован. Отменить это действие вручную будет нельзя.
              </p>
            </div>
          )}

          {error && (
            <p className="text-red-400 text-sm bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
          <button type="button" disabled={!selected || merging} onClick={handleMerge}
            className="flex-1 flex items-center justify-center gap-2 bg-[#00c26b] hover:bg-[#00b360] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm py-2.5 rounded-lg transition-colors">
            {merging && <Loader2 className="w-4 h-4 animate-spin" />}
            {merging ? 'Объединяю...' : 'Объединить'}
          </button>
          <button type="button" onClick={() => setOpen(false)}
            className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">
            Отмена
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
