import { Film } from 'lucide-react'

export default async function EditingPage() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Монтаж</h1>
        <p className="text-zinc-400 text-sm mt-1">Задачи монтажа и постпродакшн</p>
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-14 text-center">
        <Film className="w-10 h-10 text-zinc-600 mx-auto mb-4" />
        <p className="text-zinc-300 font-medium">Раздел в разработке</p>
        <p className="text-zinc-500 text-sm mt-1.5 max-w-sm mx-auto">
          Здесь будет очередь монтажных задач по сессиям и проектам
        </p>
      </div>
    </div>
  )
}
