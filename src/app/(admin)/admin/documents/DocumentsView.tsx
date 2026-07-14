'use client'

import { useState } from 'react'
import { LayoutDashboard, ScrollText, Layers, Receipt, ClipboardCheck, UserX, AlertTriangle } from 'lucide-react'
import type { DocumentsDashboardStats, ContractRowDTO, AppendixRowDTO, WorkDocumentRowDTO, ClientWithoutContractRowDTO, DocumentAttentionRowDTO } from '@/lib/actions/documents'
import DocumentsOverview from './DocumentsOverview'
import ContractsTable from './ContractsTable'
import AppendicesTable from './AppendicesTable'
import WorkDocumentsTable from './WorkDocumentsTable'
import ClientsWithoutContractTable from './ClientsWithoutContractTable'
import DocumentAttentionList from './DocumentAttentionList'

type Tab = 'overview' | 'contracts' | 'appendices' | 'invoices' | 'acts' | 'no-contract' | 'attention'

interface Props {
  stats: DocumentsDashboardStats | null
  contracts: ContractRowDTO[]
  appendices: AppendixRowDTO[]
  invoices: WorkDocumentRowDTO[]
  acts: WorkDocumentRowDTO[]
  clientsWithoutContract: ClientWithoutContractRowDTO[]
  attention: DocumentAttentionRowDTO[]
}

export default function DocumentsView({ stats, contracts, appendices, invoices, acts, clientsWithoutContract, attention }: Props) {
  const [tab, setTab] = useState<Tab>('overview')

  const TABS: { key: Tab; label: string; icon: React.ElementType; count?: number }[] = [
    { key: 'overview', label: 'Обзор', icon: LayoutDashboard },
    { key: 'contracts', label: 'Договоры', icon: ScrollText, count: contracts.length },
    { key: 'appendices', label: 'Приложения', icon: Layers, count: appendices.length },
    { key: 'invoices', label: 'Счета', icon: Receipt, count: invoices.length },
    { key: 'acts', label: 'Акты', icon: ClipboardCheck, count: acts.length },
    { key: 'no-contract', label: 'Клиенты без договора', icon: UserX, count: clientsWithoutContract.length },
    { key: 'attention', label: 'Требуют внимания', icon: AlertTriangle, count: attention.length },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 flex-wrap">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                active ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className="text-[11px] text-zinc-500 bg-zinc-900 rounded-full px-1.5 py-0.5">{t.count}</span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'overview' && (
        <DocumentsOverview
          stats={stats}
          attention={attention}
          onGoToTab={setTab}
        />
      )}
      {tab === 'contracts' && <ContractsTable contracts={contracts} />}
      {tab === 'appendices' && <AppendicesTable appendices={appendices} />}
      {tab === 'invoices' && <WorkDocumentsTable rows={invoices} kind="INVOICE" />}
      {tab === 'acts' && <WorkDocumentsTable rows={acts} kind="ACT" />}
      {tab === 'no-contract' && <ClientsWithoutContractTable clients={clientsWithoutContract} />}
      {tab === 'attention' && <DocumentAttentionList rows={attention} />}
    </div>
  )
}
