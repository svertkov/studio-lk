'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Profile, Client } from '@/lib/types'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  FolderOpen,
  FileAudio,
  Calendar,
  Star,
  LogOut,
  Mic2,
} from 'lucide-react'

interface Props {
  profile: Profile
  client: Client | null
}

const navItems = [
  { href: '/dashboard', label: 'Главная', icon: LayoutDashboard },
  { href: '/projects', label: 'Проекты', icon: FolderOpen },
  { href: '/files', label: 'Материалы', icon: FileAudio },
  { href: '/sessions', label: 'Сессии', icon: Calendar },
  { href: '/loyalty', label: 'Лояльность', icon: Star },
]

export default function ClientSidebar({ profile, client }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const tierColors: Record<string, string> = {
    BRONZE: 'text-amber-600',
    SILVER: 'text-zinc-400',
    GOLD: 'text-yellow-400',
    PLATINUM: 'text-cyan-400',
  }

  return (
    <aside className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="p-6 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Mic2 className="w-6 h-6 text-white" />
          <span className="text-white font-bold text-lg">24/70</span>
        </div>
        <p className="text-zinc-500 text-xs mt-1">Студия звукозаписи</p>
      </div>

      {/* User info */}
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-white font-semibold text-sm">
            {profile.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{profile.full_name}</p>
            {client && (
              <p className={cn('text-xs font-medium', tierColors[client.loyalty_tier])}>
                {client.loyalty_tier}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
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

      {/* Logout */}
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
