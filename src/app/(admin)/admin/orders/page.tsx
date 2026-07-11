import { getAllOrders } from '@/lib/actions/orders'
import OrdersListView from './OrdersListView'

export default async function OrdersListPage() {
  const result = await getAllOrders()

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Заказы</h1>
        <p className="text-zinc-400 text-sm mt-1">Все заказы студии</p>
      </div>
      <OrdersListView initialOrders={result.data} />
    </div>
  )
}
