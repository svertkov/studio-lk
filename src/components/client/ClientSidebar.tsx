'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Profile, Client } from '@/lib/types'
import { cn } from '@/lib/utils'
import { LayoutDashboard, FolderOpen, FileAudio, Calendar, Star, LogOut, Mic2 } from 'lucide-react'

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

const TIER_COLORS: Record<string, string> = {
  BRONZE: 'text-amber-500',
  SILVER: 'text-zinc-300',
  GOLD: 'text-yellow-400',
  PLATINUM: 'text-cyan-400',
}

export default function ClientSidebar({ profile, client }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="w-64 glass-sidebar flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="p-6 border-b glass-divider">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg glass flex items-center justify-center">
            <Mic2 className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-bold text-xl tracking-tight">2470</span>
        </div>
        <p className="text-white/30 text-xs mt-1.5 tracking-wider uppercase">Студия</p>
      </div>

      {/* User info */}
      <div className="p-4 border-b glass-divider">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full glass flex items-center justify-center text-white font-semibold text-sm border border-white/10">
            {profile.full_name?.charAt(0).toUpperCase() ?? '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{profile.full_name}</p>
            {client && (
              <p className={cn('text-xs font-medium mt-0.5', TIER_COLORS[client.loyalty_tier])}>
                {client.loyalty_tier}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
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

      {/* Logout */}
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
