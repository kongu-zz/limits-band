import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput, SessionRateLimit, SessionUsage } from 'claude-code'

import type { Place, Reading } from '../types'
import {
  bar,
  colorFor,
  costLabel,
  dirName,
  effortLabel,
  formatReset,
  formatTime,
  labelFor,
  liveWindows,
  modelName,
  newWarnings,
} from './format'

const PANE = 'limits'
const TICK_MS = 60_000
const GIT_TIMEOUT_MS = 3_000
const EMPTY = 'Лимитов пока нет: они появятся после первого ответа модели'

// Спокойные цвета темы: они сами подстраиваются под светлую и тёмную тему.
// Зелёный, жёлтый и красный остаются только у того, что заполняется.
const ACCENT = { model: 'suggestion', dir: 'planMode', branch: 'merged', effort: 'ide' } as const

const reading = atom({ plugin: 'limits-band', key: 'reading' } as const, null, { shape: 'reading-1' })
const warned = atom({ plugin: 'limits-band', key: 'warned' } as const, {}, { shape: 'warned-1' })
const request = atom({ plugin: 'limits-band', key: 'request' } as const, {}, { shape: 'request-1' })
const place = atom({ plugin: 'limits-band', key: 'place' } as const, null, { shape: 'place-1' })

type Figures = Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>

function toReading(figures: Figures, measuredAt: number): Reading {
  return {
    windows: figures.rateLimits.map(w => ({
      kind: w.kind,
      percentUsed: w.percentUsed,
      resetsAt: w.resetsAt,
    })),
    contextPercent: figures.context.percent,
    costUsd: figures.cost?.usd,
    measuredAt,
  }
}

async function readPlace($: EngineInterface): Promise<Place> {
  const root = await $.session.root()
  const base: Place = { dir: dirName(root), isDirty: false }

  try {
    const init = { cwd: root, timeoutMs: GIT_TIMEOUT_MS }
    const ref = await $.process.run(['git', 'symbolic-ref', '--short', 'HEAD'], init)
    if (ref.exitCode !== 0) return base
    const status = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain'], init)

    return { ...base, branch: ref.stdout.trim(), isDirty: status.stdout.trim() !== '' }
  } catch {
    return base
  }
}

async function refreshPlace($: EngineInterface): Promise<void> {
  const next = await readPlace($)
  await update($, place, () => next)
}

async function warn($: EngineInterface, windows: SessionRateLimit[]): Promise<void> {
  const now = await $.clock.now()
  const { due, warned: next } = newWarnings(liveWindows(windows, now), await read($, warned))
  await update($, warned, () => next)

  for (const w of due) {
    $.ui.toast(`Лимит «${labelFor(w.kind)}»: ${Math.round(w.percentUsed)}% ${formatReset(w.resetsAt, now)}`)
  }
}

function headline(
  data: Reading | null,
  model: string | undefined,
  effort: string | undefined,
  where: Place | null,
): string {
  const parts = [modelName(model)]
  if (data?.contextPercent !== undefined) parts.push(`контекст ${data.contextPercent}%`)
  if (where !== null) {
    const branch = where.branch === undefined ? '' : ` (${where.branch}${where.isDirty ? '*' : ''})`
    parts.push(`${where.dir}${branch}`)
  }
  parts.push(effortLabel(effort))
  if (data?.costUsd !== undefined) parts.push(costLabel(data.costUsd))

  return parts.join(' · ')
}

function summary(data: Reading | null, now: number): string {
  const windows = liveWindows(data?.windows ?? [], now)
  if (windows.length === 0) return EMPTY

  return windows
    .map(w => `${labelFor(w.kind)}: ${Math.round(w.percentUsed)}% ${formatReset(w.resetsAt, now)}`)
    .join('\n')
}

async function draw($: EngineInterface, e: RenderInput, notes: string[] = []) {
  const { Box, Text } = $.ui.resolve(e)
  const data = await read($, reading)
  const info = await read($, request)
  const where = await read($, place)
  const now = await $.clock.now()
  const windows = liveWindows(data?.windows ?? [], now)
  const context = data?.contextPercent
  const separator = () => <Text dimColor>│</Text>

  return (
    <Box flexDirection="column">
      <Box gap={1} flexWrap="wrap">
        <Text color={ACCENT.model}>{modelName(info.model)}</Text>
        {context !== undefined && separator()}
        {context !== undefined && <Text dimColor>контекст</Text>}
        {context !== undefined && <Text color={colorFor(context)}>{context}%</Text>}
        {where !== null && separator()}
        {where !== null && <Text color={ACCENT.dir}>{where.dir}</Text>}
        {where?.branch !== undefined && (
          <Box>
            <Text color={ACCENT.branch}>({where.branch}</Text>
            {where.isDirty && <Text color="warning">*</Text>}
            <Text color={ACCENT.branch}>)</Text>
          </Box>
        )}
        {separator()}
        {info.effort === undefined ? (
          <Text dimColor>{effortLabel(undefined)}</Text>
        ) : (
          <Text color={ACCENT.effort}>{effortLabel(info.effort)}</Text>
        )}
        {data?.costUsd !== undefined && separator()}
        {data?.costUsd !== undefined && <Text dimColor>{costLabel(data.costUsd)}</Text>}
      </Box>
      {windows.length === 0 && <Text dimColor>{EMPTY}</Text>}
      {windows.map(w => {
        const { filled, empty } = bar(w.percentUsed)
        const color = colorFor(w.percentUsed)

        return (
          <Box gap={1}>
            <Text>{labelFor(w.kind).padEnd(6)}</Text>
            <Box>
              <Text color={color}>{filled}</Text>
              <Text dimColor>{empty}</Text>
            </Box>
            <Text color={color}>{String(Math.round(w.percentUsed)).padStart(3)}%</Text>
            <Text dimColor>{formatReset(w.resetsAt, now)}</Text>
          </Box>
        )
      })}
      {data !== null && <Text dimColor>обновлено {formatTime(data.measuredAt, now)}</Text>}
      {notes.map(note => (
        <Text dimColor>{note}</Text>
      ))}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'limits',
      description: 'Показать лимиты, контекст, модель, effort и стоимость',
    })

    const now = await $.clock.now()
    const figures = await $.session.usage()
    const model = await $.session.model()
    await update($, reading, () => toReading(figures, now))
    await update($, request, old => ({ ...old, model }))
    await refreshPlace($)

    // Окно может сброситься, а ветка смениться, пока сессия простаивает: раз в
    // минуту перечитываем всё. Время последнего замера остаётся прежним.
    $.clock.every(TICK_MS, () => {
      void (async () => {
        const fresh = await $.session.usage()
        const current = await $.session.model()
        await update($, reading, old => toReading(fresh, old?.measuredAt ?? 0))
        await update($, request, old => ({ ...old, model: current }))
        await refreshPlace($)
      })()
    })

    return next(e)
  })

  // Единственное место, где виден настоящий effort: запрос к модели. Запросы
  // субагентов (у них есть agentId) идут со своими настройками и не считаются.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = e.effort === undefined ? undefined : String(e.effort)
      await update($, request, () => ({ model: e.model, effort }))
    }

    return yield* next(e)
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, reading, () => toReading(e, now))
    await warn($, e.rateLimits)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    void refreshPlace($)

    return next(e)
  })

  on('command.run', { command: 'limits' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Лимиты' })
    const data = await read($, reading)
    const info = await read($, request)
    const where = await read($, place)
    const now = await $.clock.now()

    return { text: `${headline(data, info.model, info.effort, where)}\n${summary(data, now)}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) =>
    e.props.hasSurvey ? next(e) : draw($, e),
  )

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) =>
    draw($, e, [
      'Расход других сессий виден только после следующего ответа здесь.',
      'Недельный лимит отдельной модели сюда не приходит: он есть в /usage.',
    ]),
  )
}
