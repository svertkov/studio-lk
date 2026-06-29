'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Неверный email или пароль')
      setLoading(false)
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{
      background: 'linear-gradient(135deg, #f8fffe 0%, #ffffff 50%, #f0fff8 100%)'
    }}>
      {/* Декоративные круги */}
      <div className="absolute top-0 right-0 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,194,107,0.06) 0%, transparent 70%)' }} />
      <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,194,107,0.04) 0%, transparent 70%)' }} />

      <div className="w-full max-w-sm relative">
        {/* Логотип */}
        <div className="text-center mb-8">
          <img
            src="https://static.tildacdn.com/tild3463-3931-4930-b937-626565363162/std_black-black_1_1.png"
            alt="2470 Studio"
            className="h-10 mx-auto mb-4 object-contain"
          />
          <p className="text-xs tracking-widest uppercase font-semibold"
            style={{ color: '#00c26b' }}>
            Личный кабинет
          </p>
        </div>

        <div className="login-card">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Добро пожаловать</h2>
          <p className="text-sm text-gray-400 mb-6">Войдите, чтобы получить доступ к материалам</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-600 uppercase tracking-wider text-gray-400">Email</label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="input-base"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Пароль</label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="input-base"
              />
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <button type="submit" disabled={loading} className="btn-green w-full mt-2">
              {loading ? 'Входим...' : 'Войти в кабинет'}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-400 text-xs mt-5">
          Команда студии →{' '}
          <a href="/staff-login" className="font-semibold hover:underline" style={{ color: '#00c26b' }}>
            Войти как сотрудник
          </a>
        </p>
      </div>
    </div>
  )
}
