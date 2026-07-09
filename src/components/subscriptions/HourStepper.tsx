'use client'

import { Minus, Plus } from 'lucide-react'

interface Props {
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  disabled?: boolean
  className?: string
}

function round(v: number) {
  return Math.round(v * 100) / 100
}

// Компактный +/- контрол для часов — переиспользуется в карточке абонемента
// (ручная корректировка) и в подборе абонемента заказа (списание часов),
// чтобы не плодить два разных степпера с разным видом и округлением.
export default function HourStepper({ value, onChange, step = 0.5, min = 0, max, disabled, className }: Props) {
  function clamp(v: number) {
    let r = round(v)
    if (min != null) r = Math.max(min, r)
    if (max != null) r = Math.min(max, r)
    return r
  }

  return (
    <div className={`inline-flex items-center gap-1.5 ${className ?? ''}`}>
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - step))}
        className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800 transition-colors"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        disabled={disabled}
        onChange={e => {
          const n = parseFloat(e.target.value)
          if (!Number.isNaN(n)) onChange(clamp(n))
        }}
        className="w-16 text-center bg-zinc-800 border border-zinc-700 text-zinc-100 rounded-lg py-1 text-sm outline-none focus:border-[#00c26b] transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        disabled={disabled || (max != null && value >= max)}
        onClick={() => onChange(clamp(value + step))}
        className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
