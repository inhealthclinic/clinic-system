'use client'

/**
 * Голосовое сообщение в стиле WhatsApp:
 * круглый аватар с иконкой микрофона, play/pause, «волна» из столбиков,
 * таймер. Прогресс воспроизведения подсвечивает столбики слева направо;
 * клик по волне — перемотка.
 *
 * Используется и для входящих (in), и для исходящих (out) — отличаются
 * только цветом аватара (входящие — зелёный «как WA», наши — синий «in health»).
 */

import { useEffect, useMemo, useRef, useState } from 'react'

const BAR_COUNT = 38

/** Стабильно «случайные» высоты столбиков из URL — чтобы при перерисовке не дёргалось. */
function seededHeights(seed: string): number[] {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  const out: number[] = []
  for (let i = 0; i < BAR_COUNT; i++) {
    h = (h * 1664525 + 1013904223) | 0
    const v = ((h >>> 0) % 1000) / 1000  // 0..1
    // Слегка скошенное распределение: больше «средних» баров, меньше пиков и провалов.
    const eased = 0.25 + Math.pow(v, 0.6) * 0.75
    out.push(eased)
  }
  return out
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

interface Props {
  url: string
  duration_s?: number | null
  direction: 'in' | 'out'
  /** Подпись справа внизу — обычно время сообщения. */
  timeLabel?: string
}

export function VoiceBubble({ url, duration_s, direction, timeLabel }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState<number>(duration_s ?? 0)

  const heights = useMemo(() => seededHeights(url), [url])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = () => setCur(a.currentTime)
    const onMeta = () => { if (isFinite(a.duration)) setDur(a.duration) }
    const onEnd = () => { setPlaying(false); setCur(0) }
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('loadedmetadata', onMeta)
    a.addEventListener('ended', onEnd)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('loadedmetadata', onMeta)
      a.removeEventListener('ended', onEnd)
    }
  }, [])

  function toggle() {
    const a = audioRef.current
    if (!a) return
    if (playing) {
      a.pause()
      setPlaying(false)
    } else {
      a.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
  }

  function seekFromBar(idx: number) {
    const a = audioRef.current
    if (!a || !dur) return
    const t = (idx / BAR_COUNT) * dur
    a.currentTime = t
    setCur(t)
  }

  const progress = dur > 0 ? cur / dur : 0
  const filledBars = Math.round(progress * BAR_COUNT)

  // Цвета для входящих/исходящих: in — серый круг с зелёным микрофоном (как WA),
  // out — синий круг (бренд клиники).
  const isOut = direction === 'out'
  const avatarBg = isOut ? 'bg-blue-600' : 'bg-gray-200'
  const micColor = isOut ? 'text-white' : 'text-emerald-600'
  const playColor = isOut ? 'text-white' : 'text-gray-700'
  const barIdle = isOut ? 'bg-blue-200/60' : 'bg-gray-300'
  const barActive = isOut ? 'bg-white' : 'bg-emerald-500'
  const timeColor = isOut ? 'text-blue-100' : 'text-gray-500'

  return (
    <div className="flex items-center gap-2 select-none">
      {/* Hidden audio element */}
      <audio ref={audioRef} src={url} preload="metadata" />

      {/* Play/pause */}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Пауза' : 'Воспроизвести'}
        className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${isOut ? 'bg-blue-700/40 hover:bg-blue-700/60' : 'bg-gray-100 hover:bg-gray-200'} ${playColor}`}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        )}
      </button>

      {/* Waveform + timer */}
      <div className="flex flex-col gap-0.5 min-w-[170px]">
        <div className="flex items-end gap-[2px] h-7">
          {heights.map((h, i) => (
            <button
              key={i}
              type="button"
              onClick={() => seekFromBar(i)}
              className={`w-[3px] rounded-full transition-colors ${i < filledBars ? barActive : barIdle}`}
              style={{ height: `${Math.round(h * 100)}%` }}
              aria-label={`Перемотать к ${Math.round((i / BAR_COUNT) * 100)}%`}
            />
          ))}
        </div>
        <div className={`flex items-center justify-between text-[10px] ${timeColor}`}>
          <span className="font-mono tabular-nums">{fmt(playing || cur > 0 ? cur : dur)}</span>
          {timeLabel && <span>{timeLabel}</span>}
        </div>
      </div>

      {/* Avatar with mic */}
      <div className={`relative shrink-0 w-9 h-9 rounded-full ${avatarBg} flex items-center justify-center`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className={isOut ? 'text-blue-200' : 'text-gray-400'}>
          <path d="M12 12c2.2 0 4-1.8 4-4V6a4 4 0 1 0-8 0v2c0 2.2 1.8 4 4 4zm-2 8h4v-2h-4v2zm8-9c0 3.3-2.7 6-6 6s-6-2.7-6-6H4c0 4.1 3.1 7.4 7 7.9V20h2v-1.1c3.9-.5 7-3.8 7-7.9h-2z"/>
        </svg>
        <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white flex items-center justify-center ${micColor}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/>
          </svg>
        </span>
      </div>
    </div>
  )
}
