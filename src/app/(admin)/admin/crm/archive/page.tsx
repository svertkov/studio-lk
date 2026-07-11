import { getArchivedOrders } from '@/lib/actions/orders'
import OrdersArchiveView from './OrdersArchiveView'

export default async function OrdersArchivePage() {
  const result = await getArchivedOrders()

  return (
    <div className="p-8 space-y-6">
      <OrdersArchiveView initialOrders={result.data} />
    </div>
  )
}
