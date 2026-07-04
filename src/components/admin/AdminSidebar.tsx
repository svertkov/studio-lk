'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, ShoppingBag, Calendar, Film,
  DollarSign, FileText, HardDrive, BarChart3, UserCheck,
  Settings, LogOut, MessageCircle,
} from 'lucide-react'

interface Props {
  user: { name?: string | null; role: string; email: string }
}

const navByRole: Record<string, { href: string; label: string; icon: React.ElementType }[]> = {
  OWNER: [
    { href: '/admin/dashboard',  label: 'Дашборд',    icon: LayoutDashboard },
    { href: '/admin/clients',    label: 'Клиенты',    icon: Users },
    { href: '/admin/orders',     label: 'Заказы',     icon: ShoppingBag },
    { href: '/admin/telegram',   label: 'Telegram',   icon: MessageCircle },
    { href: '/admin/schedule',   label: 'Расписание', icon: Calendar },
    { href: '/admin/editing',    label: 'Монтаж',     icon: Film },
    { href: '/admin/finance',    label: 'Финансы',    icon: DollarSign },
    { href: '/admin/documents',  label: 'Документы',  icon: FileText },
    { href: '/admin/materials',  label: 'Материалы',  icon: HardDrive },
    { href: '/admin/reports',    label: 'Отчёты',     icon: BarChart3 },
    { href: '/admin/team',       label: 'Команда',    icon: UserCheck },
    { href: '/admin/settings',   label: 'Настройки',  icon: Settings },
  ],
  ADMIN: [
    { href: '/admin/dashboard',  label: 'Дашборд',    icon: LayoutDashboard },
    { href: '/admin/clients',    label: 'Клиенты',    icon: Users },
    { href: '/admin/orders',     label: 'Заказы',     icon: ShoppingBag },
    { href: '/admin/telegram',   label: 'Telegram',   icon: MessageCircle },
    { href: '/admin/schedule',   label: 'Расписание', icon: Calendar },
  ],
  OPERATOR: [
    { href: '/admin/dashboard',  label: 'Главная',        icon: LayoutDashboard },
    { href: '/admin/schedule',   label: 'Моё расписание', icon: Calendar },
  ],
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Владелец', ADMIN: 'Администратор', OPERATOR: 'Оператор',
  EDITOR: 'Монтажёр', CLIENT: 'Клиент',
}

export default function AdminSidebar({ user }: Props) {
  const pathname = usePathname()
  const navItems = navByRole[user.role] ?? navByRole.OPERATOR ?? []

  async function handleLogout() {
    await signOut({ callbackUrl: '/staff-login' })
  }

  return (
    <aside className="sidebar-base w-60 flex flex-col h-screen sticky top-0">
      <div className="px-5 py-6 border-b divider">
        <p className="text-lg tracking-tight text-gray-900" style={{ fontWeight: 800 }}>2470</p>
        <p className="text-xs text-gray-400 mt-0.5">Управление студией</p>
      </div>

      <div className="px-4 py-4 border-b divider">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
            style={{ background: '#111111' }}
          >
            {user.name?.charAt(0).toUpperCase() ?? user.email.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{user.name ?? user.email}</p>
            <p className="text-xs text-gray-400 mt-0.5">{ROLE_LABELS[user.role] ?? user.role}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link key={href} href={href} className={cn('nav-item', isActive && 'nav-item-active')}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="p-3 border-t divider">
        <button onClick={handleLogout} className="nav-item">
          <LogOut className="w-4 h-4" />
          Выйти
        </button>
      </div>
    </aside>
  )
}
