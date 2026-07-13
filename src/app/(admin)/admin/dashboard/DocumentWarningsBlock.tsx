'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FileWarning, ChevronRight } from 'lucide-react'
import { getDocumentsDashboardStats, type DocumentsDashboardStats } from '@/lib/actions/documents'

function pluralizeInvoices(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'счёт'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'счёта'
  return 'счетов'
}

// Компактная сводка документных предупреждений на главном дашборде (ТЗ
// разд.14) — самозагружающийся клиентский компонент, тот же принцип, что
// BookingIssuesBlock: не даёт ничего, если предупреждений нет, чтобы не
// занимать место пустым блоком.
export default function DocumentWarningsBlock() {
  const [stats, setStats] = useState<DocumentsDashboardStats | null>(null)

  useEffect(() => {
    let cancelled = false
    getDocumentsDashboardStats().then(result => {
      if (!cancelled && result.ok) setStats(result.data)
    })
    return () => { cancelled = true }
  }, [])

  if (!stats) return null

  const lines: string[] = []
  if (stats.invoicesUnpaid > 0) lines.push(`${stats.invoicesUnpaid} неоплаченных ${pluralizeInvoices(stats.invoicesUnpaid)}`)
  if (stats.completedWorksWithoutAct > 0) lines.push(`${stats.completedWorksWithoutAct} завершённых работ без акта`)
  if (stats.clientsWithoutContract > 0) lines.push(`${stats.clientsWithoutContract} клиентов без указанного статуса договора`)
  if (stats.ordersWithoutInvoice > 0) lines.push(`${stats.ordersWithoutInvoice} заказов без номера счёта`)

  if (lines.length === 0) return null

  return (
    <Link
      href="/admin/documents"
      className="flex items-center gap-3 bg-amber-950/20 hover:bg-amber-950/30 border border-amber-600/40 rounded-xl px-4 py-3 transition-colors"
    >
      <FileWarning className="w-4 h-4 text-amber-400 flex-shrink-0" />
      <p className="text-amber-200 text-sm flex-1">{lines.join(' · ')}</p>
      <ChevronRight className="w-4 h-4 text-amber-400/70 flex-shrink-0" />
    </Link>
  )
}
