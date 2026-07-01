import { ShoppingBag } from 'lucide-react'

export default async function OrdersPage() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Заказы</h1>
        <p className="text-zinc-400 text-sm mt-1">Офферы, сметы и счета клиентов</p>
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-14 text-center">
        <ShoppingBag className="w-10 h-10 text-zinc-600 mx-auto mb-4" />
        <p className="text-zinc-300 font-medium">Раздел в разработке</p>
        <p className="text-zinc-500 text-sm mt-1.5 max-w-sm mx-auto">
          Здесь будут заказы, офферы и счета с управлением статусами
        </p>
      </div>
    </div>
  )
}
