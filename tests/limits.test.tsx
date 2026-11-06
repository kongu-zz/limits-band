import { expect, test } from 'claude-code/testing'

import { bar, dirName, effortLabel, formatTime, liveWindows, modelName, newWarnings } from '../hooks/format'

const NOW = Date.parse('2026-11-06T16:30:00Z')
const LATER = '2026-11-08T03:59:59Z'
const SOON = '2026-11-06T18:00:00Z'
const PAST = '2026-11-02T03:59:59Z'

const FIGURES = {
  startedAt: NOW,
  context: { tokens: 50000, window: 200000, percent: 25 },
  rateLimits: [
    { kind: 'seven_day', percentUsed: 34, resetsAt: LATER },
    { kind: 'five_hour', percentUsed: 12, resetsAt: SOON },
  ],
  cost: { usd: 1.2 },
}

const BAND = {
  plugin: 'limits-band',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const PANE = {
  plugin: 'limits-band',
  component: 'Pane',
  requestId: 'limits',
  props: {
    title: 'Лимиты',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

function engine(on: any, figures: unknown = FIGURES, git = { branch: 'main\n', status: ' M a.txt\n' }) {
  on('command.register', () => ({ value: { command: 'limits' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({ value: figures }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.root', () => ({ value: 'C:\\Users\\me\\src\\claude-features' }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', (_: unknown, e: { argv: string[] }) => ({
    value: e.argv.includes('symbolic-ref')
      ? { exitCode: git.branch === '' ? 128 : 0, stdout: git.branch, stderr: '' }
      : { exitCode: 0, stdout: git.status, stderr: '' },
  }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.measure', (_: unknown, e: { changed: string[] }) => ({ changed: e.changed }))
}

const start = ($: any, surface: string) => $.session.start({ cwd: '/', surface, isInteractive: true })

test('время идёт в двух формах, Мадрид первым, зимой и летом', () => {
  expect(formatTime(Date.parse(SOON), NOW)).toBe('19:00 (Мадрид) / 18:00Z')
  expect(formatTime(Date.parse(LATER), NOW)).toBe('8 ноя 04:59 (Мадрид) / 03:59Z')
  expect(formatTime(Date.parse('2026-07-01T10:00:00Z'), NOW)).toBe('1 июл 12:00 (Мадрид) / 10:00Z')
  expect(formatTime(Date.parse('2026-11-06T23:30:00Z'), NOW)).toBe('7 ноя 00:30 (Мадрид) / 6 ноя 23:30Z')
})

test('шкала не выходит за границы', () => {
  expect(bar(34)).toEqual({ filled: '●●●', empty: '○○○○○○○' })
  expect(bar(130)).toEqual({ filled: '●●●●●●●●●●', empty: '' })
  expect(bar(-5)).toEqual({ filled: '', empty: '○○○○○○○○○○' })
})

test('имя модели, папка и effort читаются по-человечески', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-fable-5-1[1m]')).toBe('Fable 5.1')
  expect(modelName('claude-opus-5')).toBe('Opus 5')
  expect(modelName('claude-opus-4-20250514')).toBe('Opus 4')
  expect(modelName('opus')).toBe('opus')
  expect(dirName('C:\\Users\\me\\src\\claude-features')).toBe('claude-features')
  expect(dirName('/home/me/app/')).toBe('app')
  expect(effortLabel('low')).toBe('◔ low')
  expect(effortLabel(undefined)).toBe('effort —')
})

test('окно с прошедшим сбросом не показывается, порядок: 5ч, неделя', () => {
  const windows = liveWindows(
    [
      { kind: 'seven_day', percentUsed: 88, resetsAt: PAST },
      { kind: 'seven_day', percentUsed: 34, resetsAt: LATER },
      { kind: 'five_hour', percentUsed: 12, resetsAt: SOON },
    ],
    NOW,
  )
  expect(windows.map(w => w.kind)).toEqual(['five_hour', 'seven_day'])
  expect(windows[1]?.percentUsed).toBe(34)
})

test('предупреждение на каждый порог звучит один раз', () => {
  const at = (percentUsed: number) => [{ kind: 'seven_day', percentUsed, resetsAt: LATER }]
  const first = newWarnings(at(81), {})
  expect(first.due.length).toBe(1)
  const again = newWarnings(at(85), first.warned)
  expect(again.due.length).toBe(0)
  const higher = newWarnings(at(91), again.warned)
  expect(higher.due.length).toBe(1)
})

test('полоса показывает все поля на терминале и в Desktop', async ($, on) => {
  engine(on)
  await start($, 'terminal')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    for (const words of [/^Opus 5\.5$/, /^контекст$/, /^25%$/, /^claude-features$/, /^\(main$/, /^\*$/, /^effort —$/, /^сессия ≈\$1\.20$/]) {
      expect((await ui.find({ type: 'Text', text: words }))?.text).toBeDefined()
    }
    expect((await ui.find({ type: 'Text', text: /^●●●$/ }))?.text).toBe('●●●')
    expect((await ui.find({ type: 'Text', text: /^\s*34%$/ }))?.text).toBe(' 34%')
    expect((await ui.find({ type: 'Text', text: /19:00/ }))?.text).toBe('⟳ 19:00 (Мадрид) / 18:00Z')
    expect((await ui.find({ type: 'Text', text: /обновлено/ }))?.text).toContain('(Мадрид)')
    await ui.unmount()
  }
})

test('вне репозитория ветки нет', async ($, on) => {
  engine(on, FIGURES, { branch: '', status: '' })
  await start($, 'terminal')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^\(/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^claude-features$/ }))?.text).toBeDefined()
  await ui.unmount()
})

test('чистая ветка без звёздочки', async ($, on) => {
  engine(on, FIGURES, { branch: 'main\n', status: '' })
  await start($, 'terminal')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^\(main$/ }))?.text).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\*$/ })).toBeUndefined()
  await ui.unmount()
})

test('effort берётся из запроса основного потока, субагенты его не меняют', async ($, on) => {
  engine(on)
  on('turn.step', async function* (_: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] }
  } as any)
  await start($, 'terminal')

  const step = async (input: Record<string, unknown>) => {
    const stream = ($ as any).turn.step({ turnId: 't', index: 0, messageCount: 1, ...input })
    for await (const _ of stream) {
      // Чанков здесь нет: важен только сам проход через хук.
    }
  }

  await step({ model: 'claude-opus-5-5', effort: 'high' })
  await step({ model: 'claude-haiku-5-5', effort: 'low', agentId: 'sub-1' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^● high$/ }))?.text).toBe('● high')
  expect(await ui.find({ type: 'Text', text: /Haiku/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^Opus 5\.5$/ }))?.text).toBe('Opus 5.5')
  await ui.unmount()
})

test('панель /limits рисуется на всех поверхностях, включая телефон', async ($, on) => {
  engine(on)
  await start($, 'mobile')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /неделя/ }))?.text).toContain('неделя')
    await ui.unmount()
  }
})

test('без данных честно пишет об этом и не показывает старые цифры', async ($, on) => {
  engine(on, { ...FIGURES, rateLimits: [{ kind: 'seven_day', percentUsed: 88, resetsAt: PAST }] })
  await start($, 'terminal')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Лимитов пока нет/ }))?.text).toContain('первого ответа')
  expect(await ui.find({ type: 'Text', text: /88/ })).toBeUndefined()
  await ui.unmount()
})
