export type LimitWindow = { kind: string; percentUsed: number; resetsAt?: string }

/** Последние цифры сессии. measuredAt: когда движок сообщил их в последний раз. */
export type Reading = {
  windows: LimitWindow[]
  contextPercent?: number
  costUsd?: number
  measuredAt: number
}

/** Какой порог уже показан для окна: ключ `вид@время сброса`, значение 80 или 90. */
export type Warned = Record<string, number>

/** Модель и effort. Effort известен только из запроса основного потока к модели. */
export type RequestInfo = { model?: string; effort?: string }

/** Папка сессии и состояние git; ветки нет вне репозитория. */
export type Place = { dir: string; branch?: string; isDirty: boolean }

declare module 'claude-code' {
  interface PluginState {
    'limits-band': {
      reading: Shaped<Reading | null>
      warned: Shaped<Warned>
      request: Shaped<RequestInfo>
      place: Shaped<Place | null>
    }
  }
}
