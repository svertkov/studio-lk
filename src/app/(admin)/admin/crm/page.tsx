import { getActiveOrders } from '@/lib/actions/orders'
import OrdersBoard from './OrdersBoard'

export default async function CrmPage() {
  const result = await getActiveOrders()

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">CRM</h1>
        <p className="text-zinc-400 text-sm mt-1">CRM-воронка заявок, записей и работ студии</p>
      </div>
      <OrdersBoard initialOrders={result.data} />
    </div>
  )
}
