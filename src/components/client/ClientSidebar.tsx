'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { cn } from '@/lib/utils'
import { LayoutDashboard, FolderOpen, FileAudio, Calendar, Star, LogOut } from 'lucide-react'

interface Props {
  user: { name?: string | null; email: string; role: string }
}

const navItems = [
  { href: '/dashboard', label: 'Главная',    icon: LayoutDashboard },
  { href: '/projects',  label: 'Проекты',    icon: FolderOpen },
  { href: '/files',     label: 'Материалы',  icon: FileAudio },
  { href: '/sessions',  label: 'Сессии',     icon: Calendar },
  { href: '/loyalty',   label: 'Лояльность', icon: Star },
]

export default function ClientSidebar({ user }: Props) {
  const pathname = usePathname()

  async function handleLogout() {
    await signOut({ callbackUrl: '/login' })
  }

  return (
    <aside className="sidebar-base w-60 flex flex-col h-screen sticky top-0">
      <div className="px-5 py-6 border-b divider">
        <p className="text-lg font-800 tracking-tight text-gray-900" style={{ fontWeight: 800 }}>2470</p>
        <p className="text-xs text-gray-400 mt-0.5">Студия контента</p>
      </div>

      <div className="px-4 py-4 border-b divider">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
            style={{ background: '#111111' }}>
            {user.name?.charAt(0).toUpperCase() ?? user.email.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{user.name ?? user.email}</p>
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
