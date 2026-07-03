'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

interface Props {
  icon?: React.ElementType
  label: string
  value: string
  subtitle?: string
  href?: string
  onClick?: () => void
  padding?: string
  valueClassName?: string
  iconWrapperClassName?: string
  iconClassName?: string
  labelClassName?: string
  subtitleClassName?: string
}

// Единая карточка-метрика для всех дашбордов сайта (Финансы/Клиенты/Абонементы/
// главный дашборд). Кликабельность определяется наличием href/onClick — только
// тогда показывается стрелка (без текста "Подробнее") и появляется hover.
// padding/valueClassName/iconWrapperClassName/iconClassName — точечные пропуски
// для сохранения уже существующих размеров карточек на разных страницах,
// а не редизайна с нуля.
export default function MetricCard({
  icon: Icon,
  label,
  value,
  subtitle,
  href,
  onClick,
  padding = 'p-5',
  valueClassName = 'text-2xl',
  iconWrapperClassName = 'w-8 h-8',
  iconClassName = 'w-4 h-4 text-zinc-300',
  labelClassName = 'text-zinc-400 text-xs uppercase tracking-wider',
  subtitleClassName = 'text-zinc-500 text-xs',
}: Props) {
  const clickable = !!(href || onClick)

  const cardClass = `bg-zinc-900 border rounded-xl ${padding} transition-colors duration-150 ${
    clickable ? 'border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/40 cursor-pointer group' : 'border-zinc-800'
  }`

  const body = (
    <>
      <div className={`flex items-center justify-between ${Icon ? 'mb-3' : ''}`}>
        <p className={labelClassName}>{label}</p>
        {Icon && (
          <div className={`bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0 ${iconWrapperClassName}`}>
            <Icon className={iconClassName} />
          </div>
        )}
      </div>
      <p className={`font-bold text-white truncate ${valueClassName}`}>{value}</p>
      {(subtitle || clickable) && (
        <div className="flex items-center justify-between gap-3 mt-1">
          <p className={`min-w-0 truncate ${subtitleClassName}`}>{subtitle}</p>
          {clickable && (
            <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 transition-colors flex-shrink-0" />
          )}
        </div>
      )}
    </>
  )

  if (href) {
    return <Link href={href} className={cardClass}>{body}</Link>
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${cardClass} w-full text-left`}>
        {body}
      </button>
    )
  }
  return <div className={cardClass}>{body}</div>
}
