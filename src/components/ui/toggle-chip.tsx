'use client'

import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

// Капсула-переключатель для фильтров-тумблеров — замена нативных checkbox
// там, где нужен вид "фильтрующей кнопки", единый с остальными плашками
// платформы (см. GlowPill, glow-pill.tsx: тот же приём — контур + фон + мягкая
// тень). role="switch"/aria-checked вместо checkbox-семантики; обычный
// <button> уже даёт клавиатурную активацию по Space/Enter без ручных
// keydown-обработчиков. Слот под галочку зарезервирован фиксированной
// шириной (opacity/scale вместо display/width), чтобы переключение одной
// капсулы не сдвигало соседние в строке.
interface Props {
  checked: boolean
  onChange: (next: boolean) => void
  children: ReactNode
}

export default function ToggleChip({ checked, onChange, children }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`h-10 inline-flex items-center gap-1.5 px-3.5 rounded-lg border text-sm font-medium whitespace-nowrap select-none
        cursor-pointer transition-all duration-200 ease-out hover:-translate-y-px active:scale-[0.98]
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#00c26b]
        ${checked
          ? 'bg-[#00c26b] border-[#00c26b] text-white shadow-[0_0_14px_rgba(0,194,107,0.35)] hover:shadow-[0_0_18px_rgba(0,194,107,0.45)]'
          : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:shadow-[0_4px_10px_-4px_rgba(0,0,0,0.5)]'}`}
    >
      <span
        className={`flex items-center justify-center w-3.5 h-3.5 flex-shrink-0 transition-all duration-200 ease-out ${
          checked ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
        }`}
      >
        <Check className="w-3.5 h-3.5" strokeWidth={3} />
      </span>
      {children}
    </button>
  )
}
