import { Calendar } from 'lucide-react'

export default async function SessionsPage() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">История сессий</h1>
        <p className="text-gray-400 text-sm mt-1">Все ваши посещения студии</p>
      </div>
      <div className="card-base p-14 text-center">
        <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-4" />
        <p className="text-gray-700 font-medium">Раздел в разработке</p>
        <p className="text-gray-400 text-sm mt-1.5 max-w-sm mx-auto">
          Здесь будет история всех ваших сессий в студии
        </p>
      </div>
    </div>
  )
}
