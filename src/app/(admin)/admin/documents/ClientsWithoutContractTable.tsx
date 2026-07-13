'use client'

import { useRouter } from 'next/navigation'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import GlowPill from '@/components/ui/glow-pill'
import type { ClientWithoutContractRowDTO } from '@/lib/actions/documents'
import { CLIENT_CONTRACT_STATE_LABELS, getContractStateColor } from '@/lib/document-model'
import type { ClientType } from '@prisma/client'
import { CLIENT_TYPE_LABELS } from '@/lib/client-model'

interface Props {
  clients: ClientWithoutContractRowDTO[]
}

// Отдельная вкладка, а не фиктивный номер в таблице договоров (ТЗ разд.23:
// "не смешивать клиентов без договора с таблицей договоров через фиктивный
// номер"). Сортировка по умолчанию — по алфавиту, сама сделана на сервере.
export default function ClientsWithoutContractTable({ clients }: Props) {
  const router = useRouter()

  if (clients.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center">
        <p className="text-zinc-400 text-sm">У всех клиентов указан статус договора</p>
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-800 hover:bg-transparent">
            <TableHead className="text-zinc-400">Клиент</TableHead>
            <TableHead className="text-zinc-400">Тип</TableHead>
            <TableHead className="text-zinc-400">Состояние</TableHead>
            <TableHead className="text-zinc-400">Плановая дата</TableHead>
            <TableHead className="text-zinc-400">Заказов</TableHead>
            <TableHead className="text-zinc-400">Комментарий</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map(c => (
            <TableRow
              key={c.clientId}
              className="border-zinc-800 cursor-pointer hover:bg-zinc-800/40"
              onClick={() => router.push(`/admin/clients/${c.clientId}?tab=documents`)}
            >
              <TableCell className="text-zinc-200 text-sm truncate max-w-[200px]">{c.clientName}</TableCell>
              <TableCell className="text-zinc-400 text-xs">{CLIENT_TYPE_LABELS[c.clientType as keyof typeof CLIENT_TYPE_LABELS] ?? c.clientType}</TableCell>
              <TableCell><GlowPill size="sm" color={getContractStateColor(c.clientType as ClientType, c.contractState)}>{CLIENT_CONTRACT_STATE_LABELS[c.contractState]}</GlowPill></TableCell>
              <TableCell className="text-zinc-400 text-xs">{c.contractPlannedDate ? new Date(c.contractPlannedDate).toLocaleDateString('ru-RU') : '—'}</TableCell>
              <TableCell className="text-zinc-300 text-sm">{c.ordersCount}</TableCell>
              <TableCell className="text-zinc-500 text-xs truncate max-w-[220px]">{c.contractStateComment ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
