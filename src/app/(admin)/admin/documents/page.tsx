import {
  getDocumentsDashboardStats, getContractsList, getInvoicesList, getActsList,
  getClientsWithoutContract, getDocumentAttentionList,
} from '@/lib/actions/documents'
import DocumentsView from './DocumentsView'

export default async function DocumentsPage() {
  const [statsResult, contractsResult, invoicesResult, actsResult, clientsResult, attentionResult] = await Promise.all([
    getDocumentsDashboardStats(),
    getContractsList(),
    getInvoicesList(),
    getActsList(),
    getClientsWithoutContract(),
    getDocumentAttentionList(),
  ])

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Документы</h1>
        <p className="text-zinc-400 text-sm mt-1">Реестр договоров, счетов и актов — номера и статусы, без хранения файлов</p>
      </div>
      <DocumentsView
        stats={statsResult.ok ? statsResult.data : null}
        contracts={contractsResult.data}
        invoices={invoicesResult.data}
        acts={actsResult.data}
        clientsWithoutContract={clientsResult.data}
        attention={attentionResult.data}
      />
    </div>
  )
}
