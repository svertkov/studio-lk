'use client'

import { X } from 'lucide-react'

// Полноэкранный просмотр фото — общий для ленты сообщений и панели вложений,
// чтобы не дублировать один и тот же оверлей в обоих местах.
export default function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-8" onClick={onClose}>
      <button type="button" onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white">
        <X className="w-6 h-6" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- прокси-роут, не статичный ассет */}
      <img src={url} alt="Фото" className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()} />
    </div>
  )
}
