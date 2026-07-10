import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

export type MetricCardSize = 'regular' | 'large'

interface Props {
  icon?: React.ElementType
  label: string
  value: string
  subtitle?: string
  href?: string
  onClick?: () => void
  // Готовый пресет масштаба (типографика/иконка/паддинг/высота) — используется,
  // только когда явно передан вызывающим кодом (см. FinanceStatCards.tsx).
  // Без size поведение и внешний вид карточки не меняются ни на пиксель для
  // всех уже существующих мест использования (Клиенты/Абонементы/Расходы/
  // главный дашборд) — они не передают size и продолжают получать те же
  // литеральные дефолты, что и раньше.
  size?: MetricCardSize
  className?: string
  padding?: string
  valueClassName?: string
  iconWrapperClassName?: string
  iconClassName?: string
  labelClassName?: string
  subtitleClassName?: string
}

// Общий класс для сетки, оборачивающей несколько MetricCard подряд (строка
// метрик). auto-fit/minmax реагирует на РЕАЛЬНУЮ ширину контейнера, а не на
// ширину viewport — в отличие от grid-cols-N sm:grid-cols-M lg:grid-cols-K.
// Это важно, когда карточка сама сужается (например, справа открыта панель
// Telegram-чата): при viewport-брейкпоинтах браузер всё равно применяет
// lg:grid-cols-5, даже если реального места хватает только на 2-3 колонки —
// карточки сжимаются, иконки визуально наезжают на текст, значения обрезаются.
// minmax(min(160px,100%),1fr) не даёт колонке стать уже 160px, пока это
// возможно, а на очень узких экранах не даёт ей превысить 100% контейнера
// (без этого minmax(160px,1fr) вызвал бы горизонтальный скролл на мобильных).
export const METRIC_GRID_CLASSNAME = 'grid gap-3 sm:gap-4 grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))]'

// Пресеты масштаба — большая карточка (приоритетные KPI: Выручка/Расходы факт/
// Чистая прибыль на странице Финансы) заметно просторнее обычной, но остаётся
// той же дизайн-системой (тот же тёмный фон/радиус/иконка-в-квадрате/hover),
// не отдельным стилем. min-height взят из уже существующей шкалы отступов
// Tailwind (h-40/h-48 и т.п.), а не придуман произвольно.
const SIZE_PRESETS: Record<MetricCardSize, {
  minHeight: string
  padding: string
  valueClassName: string
  iconWrapperClassName: string
  iconClassName: string
  labelClassName: string
  subtitleClassName: string
}> = {
  regular: {
    minHeight: 'min-h-40',
    padding: 'p-5',
    valueClassName: 'text-2xl',
    iconWrapperClassName: 'w-8 h-8',
    iconClassName: 'w-4 h-4 text-zinc-300',
    labelClassName: 'text-zinc-400 text-xs uppercase tracking-wider',
    subtitleClassName: 'text-zinc-500 text-xs',
  },
  large: {
    minHeight: 'min-h-48',
    padding: 'p-6',
    valueClassName: 'text-3xl mt-1',
    iconWrapperClassName: 'w-11 h-11',
    iconClassName: 'w-5 h-5 text-zinc-300',
    labelClassName: 'text-zinc-400 text-sm uppercase tracking-wider',
    subtitleClassName: 'text-zinc-400 text-xs mt-1',
  },
}

// Единая карточка-метрика для всех дашбордов сайта (Финансы/Клиенты/Абонементы/
// главный дашборд). Кликабельность определяется наличием href/onClick — только
// тогда показывается стрелка (без текста "Подробнее") и появляется hover.
// padding/valueClassName/iconWrapperClassName/iconClassName — точечные пропуски
// для сохранения уже существующих размеров карточек на разных страницах,
// а не редизайна с нуля; всегда побеждают над пресетом size, если заданы явно.
export default function MetricCard({
  icon: Icon,
  label,
  value,
  subtitle,
  href,
  onClick,
  size,
  className,
  padding,
  valueClassName,
  iconWrapperClassName,
  iconClassName,
  labelClassName,
  subtitleClassName,
}: Props) {
  const preset = size ? SIZE_PRESETS[size] : undefined
  const resolvedMinHeight = preset?.minHeight ?? ''
  const resolvedPadding = padding ?? preset?.padding ?? 'p-5'
  const resolvedValueClassName = valueClassName ?? preset?.valueClassName ?? 'text-2xl'
  const resolvedIconWrapperClassName = iconWrapperClassName ?? preset?.iconWrapperClassName ?? 'w-8 h-8'
  const resolvedIconClassName = iconClassName ?? preset?.iconClassName ?? 'w-4 h-4 text-zinc-300'
  const resolvedLabelClassName = labelClassName ?? preset?.labelClassName ?? 'text-zinc-400 text-xs uppercase tracking-wider'
  const resolvedSubtitleClassName = subtitleClassName ?? preset?.subtitleClassName ?? 'text-zinc-500 text-xs'

  const clickable = !!(href || onClick)

  const cardClass = `bg-zinc-900 border rounded-xl flex flex-col ${resolvedMinHeight} ${resolvedPadding} transition-colors duration-150 ${
    clickable ? 'border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/40 cursor-pointer group' : 'border-zinc-800'
  } ${className ?? ''}`

  // flex-col + value обёрнут в flex-1 — при отсутствии min-height (все места
  // использования без size) это не меняет высоту/раскладку ни на пиксель
  // (нечего распределять сверх контента); с min-height (Финансы, size задан)
  // это же распределяет освободившееся место так, что подпись/стрелка всегда
  // прижаты к низу карточки, а не "повисают" сразу под суммой.
  const body = (
    <div className="flex flex-col h-full min-h-0">
      <div className={`flex items-center justify-between gap-2 ${Icon ? 'mb-3' : ''}`}>
        {/* min-w-0 обязателен: без него flex-элемент по умолчанию не может
            сжаться уже своего содержимого (min-width: auto) и вместо переноса
            строки просто раздвигает родителя — из-за этого в узкой карточке
            длинная надпись выталкивала иконку за пределы блока. */}
        <p className={`min-w-0 ${resolvedLabelClassName}`}>{label}</p>
        {Icon && (
          <div className={`bg-zinc-800 rounded-lg flex items-center justify-center flex-shrink-0 ${resolvedIconWrapperClassName}`}>
            <Icon className={resolvedIconClassName} />
          </div>
        )}
      </div>
      <div className="flex-1 flex items-center min-h-0">
        <p className={`font-bold text-white truncate w-full ${resolvedValueClassName}`}>{value}</p>
      </div>
      {(subtitle || clickable) && (
        <div className="flex items-center justify-between gap-3 mt-1">
          <p className={`min-w-0 truncate ${resolvedSubtitleClassName}`}>{subtitle}</p>
          {clickable && (
            <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300 transition-colors flex-shrink-0" />
          )}
        </div>
      )}
    </div>
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
