import { getActiveOrders, buildVmFromOrder } from '@/lib/actions/orders'
import type { ScheduleEventVM } from '@/lib/schedule-model'
import OrdersBoard from './OrdersBoard'

interface Props {
  searchParams: Promise<{ openOrderId?: string }>
}

export default async function CrmPage({ searchParams }: Props) {
  const { openOrderId } = await searchParams
  const result = await getActiveOrders()

  // Карточка заказа для deep-link'а (SMM → Съёмки, «Открыть заказ»)
  // резолвится здесь, на сервере, а не клиентским useEffect — та же derived-
  // data-from-props архитектура, что уже используется в
  // admin/finance/visits/page.tsx (initialRoom/initialFormat). OrdersBoard
  // просто сидирует useState этим значением при монтировании.
  let initialSelectedVm: ScheduleEventVM | null = null
  if (openOrderId) {
    const order = result.data.find(o => o.id === openOrderId)
    if (order) {
      const vmResult = await buildVmFromOrder(order)
      if (vmResult.ok) initialSelectedVm = vmResult.data
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">CRM</h1>
        <p className="text-zinc-400 text-sm mt-1">CRM-воронка заявок, записей и работ студии</p>
      </div>
      <OrdersBoard initialOrders={result.data} initialSelectedVm={initialSelectedVm} />
    </div>
  )
}
