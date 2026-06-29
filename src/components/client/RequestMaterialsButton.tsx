'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'

export default function RequestMaterialsButton({ fileId }: { fileId: string }) {
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleRequest() {
    setLoading(true)
    // TODO: вызов API для отправки запроса менеджеру
    await new Promise(r => setTimeout(r, 800))
    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <span className="text-green-400 text-xs font-medium">
        Запрос отправлен
      </span>
    )
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleRequest}
      disabled={loading}
      className="border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800 gap-1.5"
    >
      <RefreshCw className="w-3.5 h-3.5" />
      {loading ? 'Отправляем...' : 'Запросить снова'}
    </Button>
  )
}
