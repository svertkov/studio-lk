import type { ElementType, MouseEvent, ReactNode } from 'react'

// Компактная плашка с лёгким цветным glow — тот же приём, что уже
// используется в проекте для точечных статусов (см.
// src/app/(admin)/admin/schedule/StaffAbsenceBadge.tsx: контур + затемнённый
// цветной фон + мягкая тень цвета акцента). Здесь этот же рецепт вынесен в
// один переиспользуемый компонент вместо копирования классов по местам —
// новые плашки (материалы и т.д.) должны использовать именно его, а не
// собственные варианты обводки/тени/отступов.
export type GlowPillColor = 'green' | 'amber' | 'blue' | 'red' | 'violet' | 'zinc'

// zinc — намеренно без тени: это "выключенное"/неактивное состояние, а не
// ещё один цветовой акцент (см. ТЗ: "убрать активный glow, приглушённая").
const COLOR_CLASSES: Record<GlowPillColor, string> = {
  green:  'border-green-600/50 bg-green-950/30 shadow-[0_0_10px_rgba(34,197,94,0.18)] text-green-300',
  amber:  'border-amber-600/50 bg-amber-950/30 shadow-[0_0_10px_rgba(245,158,11,0.18)] text-amber-300',
  blue:   'border-blue-600/50 bg-blue-950/30 shadow-[0_0_10px_rgba(59,130,246,0.18)] text-blue-300',
  violet: 'border-violet-600/50 bg-violet-950/30 shadow-[0_0_10px_rgba(139,92,246,0.18)] text-violet-300',
  red:    'border-red-600/50 bg-red-950/30 shadow-[0_0_10px_rgba(239,68,68,0.18)] text-red-300',
  zinc:   'border-zinc-700 bg-zinc-800/50 text-zinc-500',
}

// sm — компактный вариант для плотных мест (ячейки таблицы "Заказы" и
// подобных): меньше padding/шрифт/иконка, но тот же glow/читаемость, а не
// отдельный локальный CSS под конкретную плашку (см. доработку уплотнения
// таблицы "Заказы"). md — прежний вариант, поведение по умолчанию не меняется.
export type GlowPillSize = 'md' | 'sm'

const SIZE_CLASSES: Record<GlowPillSize, string> = {
  md: 'gap-1.5 px-2.5 py-1.5 text-xs',
  sm: 'gap-1 px-1.5 py-0.5 text-[11px]',
}
const ICON_SIZE_CLASSES: Record<GlowPillSize, string> = {
  md: 'w-3.5 h-3.5',
  sm: 'w-3 h-3',
}

interface Props {
  icon?: ElementType
  children: ReactNode
  color: GlowPillColor
  size?: GlowPillSize
  className?: string
  title?: string
}

interface StaticProps extends Props {
  as?: 'div'
}

interface LinkProps extends Props {
  as: 'a'
  href: string
  onClick?: (e: MouseEvent) => void
  ariaLabel: string
}

interface ButtonProps extends Props {
  as: 'button'
  onClick?: (e: MouseEvent) => void
  disabled?: boolean
  ariaLabel: string
  // Для капсул-переключателей (см. ConfirmableStatusToggle) — отражает
  // текущее состояние для скринридеров, не влияет на визуал.
  ariaPressed?: boolean
}

const BASE = 'inline-flex items-center rounded-lg border font-medium whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current'

export default function GlowPill(props: StaticProps | LinkProps | ButtonProps) {
  const { icon: Icon, children, color, size = 'md', className, title } = props
  const classes = `${BASE} ${SIZE_CLASSES[size]} ${COLOR_CLASSES[color]} ${className ?? ''}`
  const content = (
    <>
      {Icon && <Icon className={`${ICON_SIZE_CLASSES[size]} flex-shrink-0`} />}
      <span className="truncate">{children}</span>
    </>
  )

  if (props.as === 'a') {
    return (
      <a
        href={props.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={props.onClick}
        title={title}
        aria-label={props.ariaLabel}
        className={`${classes} cursor-pointer hover:brightness-125`}
      >
        {content}
      </a>
    )
  }

  if (props.as === 'button') {
    return (
      <button
        type="button"
        disabled={props.disabled}
        onClick={props.onClick}
        title={title}
        aria-label={props.ariaLabel}
        aria-pressed={props.ariaPressed}
        className={`${classes} ${props.disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:brightness-125'}`}
      >
        {content}
      </button>
    )
  }

  return (
    <div title={title} className={classes}>
      {content}
    </div>
  )
}
