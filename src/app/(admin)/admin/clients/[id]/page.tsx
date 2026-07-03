import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Mail, Phone, MessageCircle, Calendar, Building2, MapPin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  CLIENT_STATUS_LABELS, CLIENT_STATUS_COLORS,
  CLIENT_TYPE_LABELS, CLIENT_TYPE_COLORS,
  CLIENT_SOURCE_LABELS,
} from '@/lib/client-model'
import { getClientById } from '@/lib/actions/clients'
import { getClientSubscriptions } from '@/lib/actions/subscriptions'
import { getClientScheduleBookings } from '@/lib/actions/schedule'
import ClientTabs from './ClientTabs'
import EditClientModal from './EditClientModal'
import MergeClientModal from './MergeClientModal'

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [result, subscriptionsResult, bookingsResult] = await Promise.all([
    getClientById(id),
    getClientSubscriptions(id),
    getClientScheduleBookings(id),
  ])
  if (!result.ok || !result.data) redirect('/admin/clients')

  const client = result.data
  const initials = client.name.charAt(0).toUpperCase()

  return (
    <div className="p-8 space-y-6">
      {/* Back nav */}
      <Link
        href="/admin/clients"
        className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white text-sm transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Клиенты
      </Link>

      {/* Header card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-full bg-zinc-700 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
              {initials}
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">{client.name}</h1>
              {client.companyName && (
                <p className="text-zinc-400 text-sm mt-0.5">{client.companyName}</p>
              )}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge variant="outline" className={`text-xs ${CLIENT_TYPE_COLORS[client.type as keyof typeof CLIENT_TYPE_COLORS]}`}>
                  {CLIENT_TYPE_LABELS[client.type as keyof typeof CLIENT_TYPE_LABELS]}
                </Badge>
                <Badge variant="outline" className={`text-xs ${CLIENT_STATUS_COLORS[client.status as keyof typeof CLIENT_STATUS_COLORS]}`}>
                  {CLIENT_STATUS_LABELS[client.status as keyof typeof CLIENT_STATUS_LABELS]}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-4 mt-3">
                {client.email && (
                  <span className="flex items-center gap-1.5 text-zinc-400 text-sm">
                    <Mail className="w-3.5 h-3.5" />
                    {client.email}
                  </span>
                )}
                {client.phone && (
                  <span className="flex items-center gap-1.5 text-zinc-400 text-sm">
                    <Phone className="w-3.5 h-3.5" />
                    {client.phone}
                  </span>
                )}
                {client.telegram && (
                  <span className="flex items-center gap-1.5 text-zinc-400 text-sm">
                    <MessageCircle className="w-3.5 h-3.5" />
                    {client.telegram}
                  </span>
                )}
                <span className="flex items-center gap-1.5 text-zinc-400 text-sm">
                  <Calendar className="w-3.5 h-3.5" />
                  добавлен {new Date(client.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <MergeClientModal clientId={client.id} clientName={client.name} />
            <EditClientModal client={client} />
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-center">
          <p className="text-3xl font-bold text-white">{client.clientNotes.length}</p>
          <p className="text-zinc-500 text-xs mt-1">заметок</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-center">
          <p className="text-3xl font-bold text-white">{client.contacts.length}</p>
          <p className="text-zinc-500 text-xs mt-1">контактов</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-center">
          <p className="text-3xl font-bold text-white">{client.documents.length}</p>
          <p className="text-zinc-500 text-xs mt-1">документов</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-center">
          <p className="text-sm font-semibold text-white">
            {client.source ? CLIENT_SOURCE_LABELS[client.source as keyof typeof CLIENT_SOURCE_LABELS] : '—'}
          </p>
          <p className="text-zinc-500 text-xs mt-1">источник</p>
        </div>
      </div>

      {/* Tabs */}
      <ClientTabs client={client} subscriptions={subscriptionsResult.data} bookings={bookingsResult.data} />
    </div>
  )
}
