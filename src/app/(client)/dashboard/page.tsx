import { LayoutDashboard } from 'lucide-react'

export default async function ClientDashboardPage() {
  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Добро пожаловать</h1>
        <p className="text-gray-400 text-sm mt-1">Личный кабинет клиента студии 2470</p>
      </div>
      <div className="card-base p-14 text-center">
        <LayoutDashboard className="w-10 h-10 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-700 font-medium">Кабинет в разработке</p>
        <p className="text-gray-400 text-sm mt-1.5 max-w-sm mx-auto">
          Здесь появятся ваши сессии, материалы и история работы с 2470
        </p>
      </div>
    </div>
  )
}
