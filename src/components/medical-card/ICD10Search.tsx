'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface ICD10Code { code: string; name: string }

interface Props {
  value: string
  onChange: (code: string, name: string) => void
  placeholder?: string
}

export function ICD10Search({ value, onChange, placeholder = 'Поиск по МКБ-10...' }: Props) {
  const [query, setQuery]   = useState(value || '')
  const [results, setResults] = useState<ICD10Code[]>([])
  const [open, setOpen]     = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (query.length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('icd10_codes')
        .select('code, name')
        .or(`name.ilike.%${query}%,code.ilike.${query}%`)
        .limit(10)
      setResults(data || [])
      setOpen(true)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const select = (item: ICD10Code) => {
    setQuery(`${item.code} — ${item.name}`)
    onChange(item.code, item.name)
    setOpen(false)
    setResults([])
  }

  return (
    <div ref={ref} className="relative">
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); if (!e.target.value) onChange('', '') }}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto mt-1">
          {results.map(r => (
            <button
              key={r.code}
              onClick={() => select(r)}
              className="w-full text-left px-3 py-2.5 hover:bg-blue-50 border-b border-gray-50 last:border-0"
            >
              <span className="font-mono text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded mr-2">
                {r.code}
              </span>
              <span className="text-sm text-gray-800">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
