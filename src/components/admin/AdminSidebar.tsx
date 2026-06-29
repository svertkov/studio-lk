'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Profile } from '@/lib/types'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  Calendar,
  BarChart3,
  LogOut,
  Mic2,
  FileText,
} from 'lucide-react'

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
    <aside className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col h-screen sticky top-0">
      <div className="p-6 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Mic2 className="w-6 h-6 text-white" />
          <span className="text-white font-bold text-lg">24/70</span>
        </div>
        <p className="text-zinc-500 text-xs mt-1">Панель управления</p>
      </div>

      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-white font-semibold text-sm">
            {profile.full_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-white text-sm font-medium">{profile.full_name}</p>
            <p className="text-zinc-500 text-xs">{ROLE_LABELS[profile.role] ?? profile.role}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
              pathname === href || pathname.startsWith(href + '/')
                ? 'bg-white text-black font-medium'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            )}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="p-3 border-t border-zinc-800">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors w-full"
        >
          <LogOut className="w-4 h-4" />
          Выйти
        </button>
      </div>
    </aside>
  )
}
