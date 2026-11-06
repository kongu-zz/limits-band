import type { LimitWindow, Warned } from '../types'

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const ORDER = ['five_hour', 'seven_day', 'spend_limit']
const LABELS: Record<string, string> = { five_hour: '5ч', seven_day: 'неделя', spend_limit: 'бюджет' }

const madrid = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

type Stamp = { date: string; day: number; month: number; time: string }

const pad = (n: number): string => String(n).padStart(2, '0')

function inMadrid(ms: number): Stamp {
  const parts: Record<string, string> = {}
  for (const part of madrid.formatToParts(new Date(ms))) parts[part.type] = part.value
  const day = Number(parts.day)
  const month = Number(parts.month) - 1

  return { date: `${parts.year}-${month}-${day}`, day, month, time: `${parts.hour}:${parts.minute}` }
}

function inUtc(ms: number): Stamp {
  const d = new Date(ms)
  const day = d.getUTCDate()
  const month = d.getUTCMonth()

  return { date: `${d.getUTCFullYear()}-${month}-${day}`, day, month, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` }
}

const withDate = (s: Stamp): string => `${s.day} ${MONTHS[s.month]} ${s.time}`

/** Время в две формы, Мадрид первым; дата видна, только если это не сегодня. */
export function formatTime(ms: number, nowMs: number): string {
  const local = inMadrid(ms)
  const utc = inUtc(ms)
  const left = local.date === inMadrid(nowMs).date ? local.time : withDate(local)
  const right = utc.date === local.date ? utc.time : withDate(utc)

  return `${left} (Мадрид) / ${right}Z`
}

export function formatReset(resetsAt: string | undefined, nowMs: number): string {
  const ms = resetsAt === undefined ? NaN : Date.parse(resetsAt)

  return Number.isNaN(ms) ? '' : `⟳ ${formatTime(ms, nowMs)}`
}

export function bar(percent: number, width = 10): { filled: string; empty: string } {
  const clamped = Math.min(100, Math.max(0, percent))
  const filled = Math.round((clamped * width) / 100)

  return { filled: '●'.repeat(filled), empty: '○'.repeat(width - filled) }
}

/** `claude-opus-5-5` → `Opus 5.5`; что не похоже на такой id, остаётся как есть. */
export function modelName(id: string | undefined): string {
  if (id === undefined || id === '') return '—'
  const match = /^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?(?!\d)/.exec(id)
  if (match === null) return id
  const family = match[1] ?? ''
  const version = match[3] === undefined ? match[2] : `${match[2]}.${match[3]}`

  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version}`
}

export const dirName = (root: string): string =>
  root.split(/[\\/]+/).filter(Boolean).pop() ?? root

const EFFORT_MARKS: Record<string, string> = { low: '◔', medium: '◑', high: '●', xhigh: '◉', max: '◉' }

export function effortLabel(effort: string | undefined): string {
  if (effort === undefined) return 'effort —'
  const mark = EFFORT_MARKS[effort]

  return mark === undefined ? effort : `${mark} ${effort}`
}

export function colorFor(percent: number): 'error' | 'warning' | 'success' {
  if (percent >= 90) return 'error'

  return percent >= 70 ? 'warning' : 'success'
}

export const labelFor = (kind: string): string => LABELS[kind] ?? kind

/** Оценка стоимости сессии по ценам API. Это не счёт, поэтому со знаком ≈. */
export const costLabel = (usd: number): string => `сессия ≈$${usd.toFixed(2)}`

/** Окна, которые ещё действуют: прошедший сброс означает, что цифра устарела. */
export function liveWindows(windows: LimitWindow[], nowMs: number): LimitWindow[] {
  const rank = (kind: string): number => {
    const at = ORDER.indexOf(kind)

    return at === -1 ? ORDER.length : at
  }

  return windows
    .filter(w => w.resetsAt === undefined || Date.parse(w.resetsAt) > nowMs)
    .sort((a, b) => rank(a.kind) - rank(b.kind))
}

/** Какие окна впервые перешли 80% или 90%; у нового окна счёт начинается заново. */
export function newWarnings(
  windows: LimitWindow[],
  warned: Warned,
): { due: LimitWindow[]; warned: Warned } {
  const next: Warned = {}
  const due: LimitWindow[] = []

  for (const w of windows) {
    const key = `${w.kind}@${w.resetsAt ?? ''}`
    const level = w.percentUsed >= 90 ? 90 : w.percentUsed >= 80 ? 80 : 0
    const shown = warned[key] ?? 0
    if (level > shown) due.push(w)
    next[key] = Math.max(level, shown)
  }

  return { due, warned: next }
}
