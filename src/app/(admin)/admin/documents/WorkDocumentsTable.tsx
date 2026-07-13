'use client'

import { useRouter } from 'next/navigation'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import GlowPill from '@/components/ui/glow-pill'
import type { WorkDocumentRowDTO } from '@/lib/actions/documents'
import { DOCUMENT_STATUS_LABELS, DOCUMENT_PAYMENT_STATE_LABELS, INVOICE_PURPOSE_LABELS } from '@/lib/document-model'

function formatDate(v: string) {
  return new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatMoney(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(v)
}

interface Props {
  rows: WorkDocumentRowDTO[]
  kind: 'INVOICE' | 'ACT'
}

const PAYMENT_COLOR: Record<string, 'green' | 'amber' | 'zinc'> = { PAID: 'green', PARTIALLY_PAID: 'amber', PENDING: 'amber', NOT_REQUIRED: 'zinc', UNKNOWN: 'zinc' }

export default function WorkDocumentsTable({ rows, kind }: Props) {
  const router = useRouter()

  if (rows.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center">
        <p className="text-zinc-400 text-sm">{kind === 'INVOICE' ? 'Счетов' : 'Актов'} пока нет</p>
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-800 hover:bg-transparent">
            <TableHead className="text-zinc-400">№</TableHead>
            <TableHead className="text-zinc-400">Дата</TableHead>
            <TableHead className="text-zinc-400">Клиент</TableHead>
            <TableHead className="text-zinc-400">Работа</TableHead>
            <TableHead className="text-zinc-400">Тип</TableHead>
            {kind === 'INVOICE' && <TableHead className="text-zinc-400">Назначение</TableHead>}
            {kind === 'INVOICE' && <TableHead className="text-zinc-400">Сумма</TableHead>}
            <TableHead className="text-zinc-400">Статус</TableHead>
            {kind === 'INVOICE' && <TableHead className="text-zinc-400">Оплата</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.id} className="border-zinc-800 cursor-pointer hover:bg-zinc-800/40" onClick={() => router.push(r.workHref)}>
              <TableCell className="text-zinc-200 text-sm">{r.displayNumber}</TableCell>
              <TableCell className="text-zinc-300 text-sm">{formatDate(r.issueDate)}</TableCell>
              <TableCell className="text-zinc-200 text-sm truncate max-w-[180px]">{r.clientName}</TableCell>
              <TableCell className="text-zinc-300 text-sm truncate max-w-[200px]">{r.workTitle}</TableCell>
              <TableCell className="text-zinc-500 text-xs">{r.workKind === 'ORDER' ? 'Съёмка' : 'Монтаж'}</TableCell>
              {kind === 'INVOICE' && <TableCell className="text-zinc-400 text-xs">{r.purpose ? INVOICE_PURPOSE_LABELS[r.purpose] : '—'}</TableCell>}
              {kind === 'INVOICE' && <TableCell className="text-zinc-200 text-sm">{formatMoney(r.amount)}</TableCell>}
              <TableCell><GlowPill size="sm" color="zinc">{DOCUMENT_STATUS_LABELS[r.status]}</GlowPill></TableCell>
              {kind === 'INVOICE' && (
                <TableCell>
                  <GlowPill size="sm" color={PAYMENT_COLOR[r.paymentState]}>{DOCUMENT_PAYMENT_STATE_LABELS[r.paymentState as keyof typeof DOCUMENT_PAYMENT_STATE_LABELS]}</GlowPill>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
