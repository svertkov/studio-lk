'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Profile } from '@/lib/types'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Users, Calendar, BarChart3, LogOut, Mic2, FileText } from 'lucide-react'

interface Props { profile: Profile }

const navByRole = {
  OWNER: [
    { href: '/admin/dashboard', label: 'Дашборд', icon: LayoutDashboard },
    { href: '/admin/clients', label: 'Клиенты', icon: Users },
    { href: '/admin/schedule', label: 'Расписание', icon: Calendar },
    { href: '/admin/reports', label: 'Отчёты', icon: BarChart3 },
    { href: '/admin/finance', label: 'Финансы', icon: FileText },
  ],
  MANAGER: [
    { href: '/admin/dashboard', label: 'Дашборд', icon: LayoutDashboard },
    { href: '/admin/clients', label: 'Клиенты', icon: Users },
    { href: '/admin/schedule', label: 'Расписание', icon: Calendar },
  ],
  STAFF: [
    { href: '/admin/dashboard', label: 'Главная', icon: LayoutDashboard },
    { href: '/admin/schedule', label: 'Моё расписание', icon: Calendar },
  ],
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Владелец',
  MANAGER: 'Менеджер',
  STAFF: 'Сотрудник',
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
    <aside className="w-64 glass-sidebar flex flex-col h-screen sticky top-0">
      <div className="p-6 border-b glass-divider">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg glass flex items-center justify-center">
            <Mic2 className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-bold text-xl tracking-tight">2470</span>
        </div>
        <p className="text-white/30 text-xs mt-1.5 tracking-wider uppercase">Управление</p>
      </div>

      <div className="p-4 border-b glass-divider">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full glass flex items-center justify-center text-white font-semibold text-sm border border-white/10">
            {profile.full_name?.charAt(0).toUpperCase() ?? '?'}
          </div>
          <div>
            <p className="text-white text-sm font-medium">{profile.full_name}</p>
            <p className="text-white/30 text-xs mt-0.5">{ROLE_LABELS[profile.role] ?? profile.role}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200',
                isActive
                  ? 'glass-nav-active font-medium'
                  : 'text-white/40 hover:text-white/80 hover:bg-white/[0.04]'
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="p-3 border-t glass-divider">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/30 hover:text-white/70 hover:bg-white/[0.04] transition-all duration-200 w-full"
        >
          <LogOut className="w-4 h-4" />
          Выйти
        </button>
      </div>
    </aside>
  )
}
