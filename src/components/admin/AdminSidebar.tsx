'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Profile } from '@/lib/types'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Users, Calendar, BarChart3, LogOut, FileText } from 'lucide-react'

interface Props { profile: Profile }

const navByRole = {
  OWNER: [
    { href: '/admin/dashboard', label: 'Дашборд',    icon: LayoutDashboard },
    { href: '/admin/clients',   label: 'Клиенты',    icon: Users },
    { href: '/admin/schedule',  label: 'Расписание', icon: Calendar },
    { href: '/admin/reports',   label: 'Отчёты',     icon: BarChart3 },
    { href: '/admin/finance',   label: 'Финансы',    icon: FileText },
  ],
  MANAGER: [
    { href: '/admin/dashboard', label: 'Дашборд',    icon: LayoutDashboard },
    { href: '/admin/clients',   label: 'Клиенты',    icon: Users },
    { href: '/admin/schedule',  label: 'Расписание', icon: Calendar },
  ],
  STAFF: [
    { href: '/admin/dashboard', label: 'Главная',        icon: LayoutDashboard },
    { href: '/admin/schedule',  label: 'Моё расписание', icon: Calendar },
  ],
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Владелец', MANAGER: 'Менеджер', STAFF: 'Сотрудник',
}

export default function AdminSidebar({ profile }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const navItems = navByRole[profile.role as keyof typeof navByRole] ?? navByRole.STAFF

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/staff-login')
    router.refresh()
  }

  return (
    <aside className="sidebar-base w-60 flex flex-col h-screen sticky top-0">
      <div className="px-5 py-6 border-b divider">
        <p className="text-lg tracking-tight text-gray-900" style={{ fontWeight: 800 }}>2470</p>
        <p className="text-xs text-gray-400 mt-0.5">Управление студией</p>
      </div>

      <div className="px-4 py-4 border-b divider">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
            style={{ background: '#111111' }}>
            {profile.full_name?.charAt(0).toUpperCase() ?? '?'}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{profile.full_name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{ROLE_LABELS[profile.role] ?? profile.role}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
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
