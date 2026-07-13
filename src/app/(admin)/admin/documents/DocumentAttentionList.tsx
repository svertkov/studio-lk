'use client'

import Link from 'next/link'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import type { DocumentAttentionRowDTO } from '@/lib/actions/documents'
import { DOCUMENT_ATTENTION_LABELS } from '@/lib/document-model'

interface Props {
  rows: DocumentAttentionRowDTO[]
}

export default function DocumentAttentionList({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center">
        <p className="text-zinc-400 text-sm">Проблем не найдено — все документы в порядке</p>
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/60">
      {rows.map(row => (
        <Link
          key={row.id}
          href={row.workHref}
          className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-zinc-800/40 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <p className="text-zinc-200 text-sm truncate">{row.workTitle}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="flex flex-wrap items-center gap-1.5 justify-end max-w-[420px]">
              {row.reasons.map(r => (
                <span key={r} className="text-[11px] text-amber-300 bg-amber-900/30 rounded-full px-2 py-0.5 whitespace-nowrap">
                  {DOCUMENT_ATTENTION_LABELS[r]}
                </span>
              ))}
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-600" />
          </div>
        </Link>
      ))}
    </div>
  )
}
