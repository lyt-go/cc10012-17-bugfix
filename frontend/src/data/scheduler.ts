/** 定时调度的纯函数：cron 解析、下一次运行时间、状态机规则和时间格式化。 */

export type CronValidation = { ok: true } | { ok: false; message: string }

export type CronFields = {
  minutes: Set<number>
  hours: Set<number>
  daysOfMonth: Set<number>
  months: Set<number>
  daysOfWeek: Set<number>
  domRestricted: boolean
  dowRestricted: boolean
}

const FIELD_RULES = [
  { name: '分钟', min: 0, max: 59 },
  { name: '小时', min: 0, max: 23 },
  { name: '日', min: 1, max: 31 },
  { name: '月', min: 1, max: 12 },
  // 星期允许 0-7，其中 7 与 0 都代表周日。
  { name: '星期', min: 0, max: 7 },
]

function parseNumber(text: string, min: number, max: number, label: string): number {
  if (!/^\d+$/.test(text)) {
    throw new Error(`${label}「${text}」不是有效数字`)
  }
  const value = Number(text)
  if (value < min || value > max) {
    throw new Error(`${label}「${text}」超出范围 ${min}-${max}`)
  }
  return value
}

function parseField(text: string, min: number, max: number, label: string): { values: Set<number>; restricted: boolean } {
  const values = new Set<number>()
  let restricted = false
  if (text === '*') {
    for (let value = min; value <= max; value += 1) values.add(value)
    return { values, restricted }
  }
  for (const item of text.split(',')) {
    if (item === '') throw new Error(`${label}存在空的取值`)
    let base = item
    let step = 1
    const slash = item.indexOf('/')
    if (slash >= 0) {
      base = item.slice(0, slash)
      const stepText = item.slice(slash + 1)
      if (!/^\d+$/.test(stepText) || Number(stepText) < 1) {
        throw new Error(`${label}的步长「${stepText}」无效`)
      }
      step = Number(stepText)
    }
    let from = min
    let to = max
    if (base !== '*') {
      restricted = true
      const dash = base.indexOf('-')
      if (dash >= 0) {
        from = parseNumber(base.slice(0, dash), min, max, label)
        to = parseNumber(base.slice(dash + 1), min, max, label)
        if (from > to) throw new Error(`${label}的区间「${base}」起点大于终点`)
      } else {
        from = parseNumber(base, min, max, label)
        to = from
      }
    }
    for (let value = from; value <= to; value += step) {
      values.add(label === '星期' && value === 7 ? 0 : value)
    }  }
  if (values.size === 0) throw new Error(`${label}没有可用取值`)
  return { values, restricted }
}

export function parseCron(expr: string): { ok: true; fields: CronFields } | { ok: false; message: string } {
  const text = String(expr ?? '').trim()
  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length !== 5) {
    return { ok: false, message: `调度cron「${text || '空'}」必须是 5 段（分 时 日 月 星期）` }
  }
  try {
    const minute = parseField(parts[0], FIELD_RULES[0].min, FIELD_RULES[0].max, FIELD_RULES[0].name)
    const hour = parseField(parts[1], FIELD_RULES[1].min, FIELD_RULES[1].max, FIELD_RULES[1].name)
    const dom = parseField(parts[2], FIELD_RULES[2].min, FIELD_RULES[2].max, FIELD_RULES[2].name)
    const month = parseField(parts[3], FIELD_RULES[3].min, FIELD_RULES[3].max, FIELD_RULES[3].name)
    const dow = parseField(parts[4], FIELD_RULES[4].min, FIELD_RULES[4].max, FIELD_RULES[4].name)
    return {
      ok: true,
      fields: {
        minutes: minute.values,
        hours: hour.values,
        daysOfMonth: dom.values,
        months: month.values,
        daysOfWeek: dow.values,
        domRestricted: dom.restricted,
        dowRestricted: dow.restricted,
      },
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : `${text} 无法解析` }
  }
}

export function validateCron(expr: string): CronValidation {
  const parsed = parseCron(expr)
  return parsed.ok ? { ok: true } : { ok: false, message: parsed.message }
}

export function cronMatches(date: Date, expr: string): boolean {
  const parsed = parseCron(expr)
  if (!parsed.ok) return false
  const { fields } = parsed
  if (!fields.months.has(date.getMonth() + 1)) return false
  if (!fields.hours.has(date.getHours())) return false
  if (!fields.minutes.has(date.getMinutes())) return false
  const domHit = fields.daysOfMonth.has(date.getDate())
  const dowHit = fields.daysOfWeek.has(date.getDay())
  if (fields.domRestricted && fields.dowRestricted) return domHit || dowHit
  if (fields.domRestricted) return domHit
  if (fields.dowRestricted) return dowHit
  return true
}

export function nextCronOccurrence(expr: string, after: Date | string): Date | null {
  const parsed = parseCron(expr)
  if (!parsed.ok) return null
  const afterDate = after instanceof Date ? new Date(after.getTime()) : parseDateTime(after)
  if (!afterDate || Number.isNaN(afterDate.getTime())) return null

  const cursor = new Date(afterDate.getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)

  // 逐分钟推进；上限 5 年，既能覆盖 2 月 29 日这类低频表达式，又不会死循环。
  const guardLimit = 5 * 366 * 24 * 60
  for (let guard = 0; guard < guardLimit; guard += 1) {
    const month = cursor.getMonth() + 1
    if (!parsed.fields.months.has(month)) {
      cursor.setDate(1)
      cursor.setHours(0, 0, 0, 0)
      cursor.setMonth(cursor.getMonth() + 1)
      continue
    }
    const domHit = parsed.fields.daysOfMonth.has(cursor.getDate())
    const dowHit = parsed.fields.daysOfWeek.has(cursor.getDay())
    const dayHit = parsed.fields.domRestricted && parsed.fields.dowRestricted
      ? domHit || dowHit
      : parsed.fields.domRestricted
        ? domHit
        : parsed.fields.dowRestricted
          ? dowHit
          : true
    if (!dayHit) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }
    if (!parsed.fields.hours.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!parsed.fields.minutes.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0)
      continue
    }
    return new Date(cursor.getTime())
  }
  return null
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDateTime(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function parseDateTime(value: string): Date | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const normalized = text.includes('T') ? text : text.replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function normalizeScheduledMinute(value: Date | string): string {
  const date = typeof value === 'string' ? parseDateTime(value) : new Date(value.getTime())
  if (!date) return ''
  date.setSeconds(0, 0)
  return formatDateTime(date)
}

export const SCHEDULER_ACTIONS = {
  '提定时评审': { from: ['草稿'], to: '定时评审中' },
  '启用定时': { from: ['定时评审中', '已暂停'], to: '已启用' },
  '暂停定时': { from: ['已启用'], to: '已暂停' },
} as const

export type SchedulerAction = keyof typeof SCHEDULER_ACTIONS

export function isActiveRun(status: string): boolean {
  return status === '排队中' || status === '运行中'
}
