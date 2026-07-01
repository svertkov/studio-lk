import { UserCheck } from 'lucide-react'

export default async function TeamPage() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Команда</h1>
        <p className="text-zinc-400 text-sm mt-1">Сотрудники студии и их роли</p>
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-14 text-center">
        <UserCheck className="w-10 h-10 text-zinc-600 mx-auto mb-4" />
        <p className="text-zinc-300 font-medium">Раздел в разработке</p>
        <p className="text-zinc-500 text-sm mt-1.5 max-w-sm mx-auto">
          Здесь будет список сотрудников, роли и управление доступом
        </p>
      </div>
    </div>
  )
}
