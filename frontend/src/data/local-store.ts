import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'data-explore-selfservice:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null
const sliceCache = new Map<string, unknown>()

// 运行记录、结果数据集是结构化数据，单独放在同一份 localStorage 文档里的独立命名空间，
// 既不挤占业务条目的字段结构，又能和条目一起持久化。
const SLICE_PREFIX = `${STORAGE_KEY}:slice:`

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

function cloneSlice<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function readSlice<T>(name: string, fallback: T): T {
  if (sliceCache.has(name)) {
    return cloneSlice(sliceCache.get(name) as T)
  }
  let value = cloneSlice(fallback)
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(`${SLICE_PREFIX}${name}`)
    if (raw) {
      try {
        value = JSON.parse(raw) as T
      } catch {
        value = cloneSlice(fallback)
      }
    }
  }
  sliceCache.set(name, value)
  return cloneSlice(value)
}

export function writeSlice<T>(name: string, value: T): void {
  const stored = cloneSlice(value)
  sliceCache.set(name, stored)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(`${SLICE_PREFIX}${name}`, JSON.stringify(stored))
  }
}

export function resetSlice<T>(name: string, fallback: T): T {
  writeSlice(name, fallback)
  return cloneSlice(fallback)
}

