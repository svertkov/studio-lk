'use client'

import { useRouter } from 'next/navigation'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import GlowPill from '@/components/ui/glow-pill'
import type { ContractRowDTO } from '@/lib/actions/documents'
import { DOCUMENT_STATUS_LABELS } from '@/lib/document-model'
import { CLIENT_TYPE_LABELS } from '@/lib/client-model'

function formatDate(v: string) {
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Props {
  contracts: ContractRowDTO[]
}

// Сортировка по умолчанию — по номеру договора от нового к старому (ТЗ
// разд.22), сама сортировка уже сделана на сервере (getContractsList).
export default function ContractsTable({ contracts }: Props) {
  const router = useRouter()

  if (contracts.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center">
        <p className="text-zinc-400 text-sm">Договоров пока нет</p>
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-800 hover:bg-transparent">
            <TableHead className="text-zinc-400">№ договора</TableHead>
            <TableHead className="text-zinc-400">Дата</TableHead>
            <TableHead className="text-zinc-400">Клиент</TableHead>
            <TableHead className="text-zinc-400">Тип</TableHead>
            <TableHead className="text-zinc-400">Статус</TableHead>
            <TableHead className="text-zinc-400">Заказов</TableHead>
            <TableHead className="text-zinc-400">Счетов</TableHead>
            <TableHead className="text-zinc-400">Актов</TableHead>
            <TableHead className="text-zinc-400">Комментарий</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contracts.map(c => (
            <TableRow
              key={c.id}
              className="border-zinc-800 cursor-pointer hover:bg-zinc-800/40"
              onClick={() => router.push(`/admin/clients/${c.clientId}?tab=documents`)}
            >
              <TableCell className="text-zinc-200 text-sm">№{c.number ?? '—'}</TableCell>
              <TableCell className="text-zinc-300 text-sm">{formatDate(c.issueDate)}</TableCell>
              <TableCell className="text-zinc-200 text-sm truncate max-w-[200px]">{c.clientName}</TableCell>
              <TableCell className="text-zinc-400 text-xs">{CLIENT_TYPE_LABELS[c.clientType as keyof typeof CLIENT_TYPE_LABELS] ?? c.clientType}</TableCell>
              <TableCell><GlowPill size="sm" color={c.status === 'ACTIVE' ? 'green' : 'zinc'}>{DOCUMENT_STATUS_LABELS[c.status]}</GlowPill></TableCell>
              <TableCell className="text-zinc-300 text-sm">{c.ordersCount}</TableCell>
              <TableCell className="text-zinc-300 text-sm">{c.invoicesCount}</TableCell>
              <TableCell className="text-zinc-300 text-sm">{c.actsCount}</TableCell>
              <TableCell className="text-zinc-500 text-xs truncate max-w-[200px]">{c.comment ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
