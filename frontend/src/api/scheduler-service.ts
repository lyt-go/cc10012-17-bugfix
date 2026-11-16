import {
  listRows,
  readSlice,
  resetSlice,
  saveRows,
  writeSlice,
} from '@/data/local-store'
import {
  SCHEDULER_ACTIONS,
  isActiveRun,
  nextCronOccurrence,
  normalizeScheduledMinute,
  parseDateTime,
  validateCron,
} from '@/data/scheduler'
import type { SchedulerAction } from '@/data/scheduler'
import {
  SEED_SCHEDULER_EVENTS,
  SEED_SCHEDULER_RESULT_SETS,
  SEED_SCHEDULER_RUNS,
} from '@/data/scheduler-seed'
import type { SchedulerEvent } from '@/data/scheduler-seed'
import type {
  ActionResult,
  EntryRow,
  SchedulerResultSet,
  SchedulerRun,
} from '@/data/types'

// 定时调度数据流：作业条目 → 运行记录 → 结果数据集。
// 页面「定时任务」和「数据导出」读同一份运行/结果数据，避免两处展示不一致。

const JOB_KEY = 'schedulerjob'
const RUNS_SLICE = 'scheduler-job-runs'
const RESULTS_SLICE = 'scheduler-job-results'
const EVENTS_SLICE = 'scheduler-job-events'

export const JOB_ENABLED = '已启用'
const MAX_CATCH_UP = 24

export type DispatchOutcome = ActionResult & {
  code?: string
  runId?: string
  resultSetId?: string
  scheduledAt?: string
}

type Store = {
  runs: SchedulerRun[]
  results: SchedulerResultSet[]
  events: SchedulerEvent[]
}

function minuteText(now: Date): string {
  return normalizeScheduledMinute(now)
}

function stamp(now: Date): string {
  return minuteText(now).replace(' ', '-').replace(':', '')
}

function jobText(job: EntryRow, field: string): string {
  return String(job[field] ?? '')
}

function jobRows(): EntryRow[] {
  return listRows(JOB_KEY)
}

export function jobById(jobId: number): EntryRow | undefined {
  return jobRows().find((row) => Number(row.id) === jobId)
}

function saveJob(updated: EntryRow): void {
  saveRows(
    JOB_KEY,
    jobRows().map((row) => (Number(row.id) === Number(updated.id) ? updated : row)),
  )
}

export function schedulerRuns(jobId?: number): SchedulerRun[] {
  const runs = readSlice<SchedulerRun[]>(RUNS_SLICE, SEED_SCHEDULER_RUNS)
  const scoped = jobId === undefined ? runs : runs.filter((run) => run.jobId === jobId)
  return [...scoped].sort((a, b) =>
    a.scheduledAt < b.scheduledAt ? -1 : a.scheduledAt > b.scheduledAt ? 1 : a.runId < b.runId ? -1 : 1,
  )
}

export function schedulerResultSets(jobId?: number): SchedulerResultSet[] {
  const results = readSlice<SchedulerResultSet[]>(RESULTS_SLICE, SEED_SCHEDULER_RESULT_SETS)
  const scoped = jobId === undefined ? results : results.filter((item) => item.jobId === jobId)
  return [...scoped].sort((a, b) =>
    a.scheduledAt < b.scheduledAt ? -1 : a.scheduledAt > b.scheduledAt ? 1 : a.resultSetId < b.resultSetId ? -1 : 1,
  )
}

export function schedulerEvents(jobId?: number): SchedulerEvent[] {
  const events = readSlice<SchedulerEvent[]>(EVENTS_SLICE, SEED_SCHEDULER_EVENTS)
  const scoped = jobId === undefined ? events : events.filter((event) => event.jobId === jobId)
  return [...scoped].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

export function resultSetById(resultSetId: string): SchedulerResultSet | undefined {
  return schedulerResultSets().find((item) => item.resultSetId === resultSetId)
}

export function runById(runId: string): SchedulerRun | undefined {
  return schedulerRuns().find((item) => item.runId === runId)
}

/** 作业最近一次成功运行；数据导出侧用它同步作业编号与查询版本。 */
export function latestCompletedRun(jobId?: number): SchedulerRun | undefined {
  const runs = schedulerRuns(jobId).filter((run) => run.status === '已完成')
  return runs.length ? runs[runs.length - 1] : undefined
}

/** 导出任务与定时结果数据集的来源对齐：按任务编号里出现的作业编号匹配，否则取最近一次成功运行。 */
export function lineageForTask(row: EntryRow): SchedulerRun | undefined {
  const source = String(row['数据来源'] ?? '')
  const matched = schedulerRuns().filter(
    (run) => run.status === '已完成' && source.includes(run.jobCode),
  )
  if (matched.length) return matched[matched.length - 1]
  return latestCompletedRun()
}

export function resetSchedulerData(): void {
  resetSlice(RUNS_SLICE, SEED_SCHEDULER_RUNS)
  resetSlice(RESULTS_SLICE, SEED_SCHEDULER_RESULT_SETS)
  resetSlice(EVENTS_SLICE, SEED_SCHEDULER_EVENTS)
}

function writeStore(store: Partial<Store>, replacedJobs: number[] = []): void {
  if (store.runs) {
    // 运行记录只增不删；按运行编号合并，新的终态覆盖旧的同编号记录。
    const merged = new Map<string, SchedulerRun>()
    for (const run of readSlice<SchedulerRun[]>(RUNS_SLICE, SEED_SCHEDULER_RUNS)) {
      merged.set(run.runId, run)
    }
    for (const run of store.runs) merged.set(run.runId, run)
    writeSlice(RUNS_SLICE, [...merged.values()])
  }
  if (store.results) {
    const merged = new Map<string, SchedulerResultSet>()
    for (const item of readSlice<SchedulerResultSet[]>(RESULTS_SLICE, SEED_SCHEDULER_RESULT_SETS)) {
      if (replacedJobs.includes(item.jobId)) continue
      merged.set(item.resultSetId, item)
    }
    // 同一结果集编号只留一条：同一调度点重复执行也只会有一份结果。
    for (const item of store.results) merged.set(item.resultSetId, item)
    writeSlice(RESULTS_SLICE, [...merged.values()])
  }
  if (store.events) writeSlice(EVENTS_SLICE, store.events)
}

function appendEvent(input: Omit<SchedulerEvent, 'eventId'>, now: Date): void {
  const events = schedulerEvents()
  events.push({
    ...input,
    eventId: `EVT-${stamp(now)}-${String(events.length + 1).padStart(4, '0')}`,
  })
  writeStore({ events })
}

export type QueryLink =
  | { ok: true; query: EntryRow }
  | { ok: false; message: string; code: string }

/** 关联查询是否可用于调度：不存在或被归档都视为失效。 */
export function resolveQuery(job: EntryRow): QueryLink {
  const code = jobText(job, '关联查询')
  if (!code) {
    return { ok: false, code: 'QUERY_MISSING', message: '作业未配置关联查询，调度被阻断' }
  }
  const query = listRows('queryeditor').find((row) => String(row['脚本编号'] ?? '') === code)
  if (!query) {
    return { ok: false, code: 'QUERY_MISSING', message: `关联查询 ${code} 不存在，调度被阻断` }
  }
  if (String(query.status) === '已归档') {
    return {
      ok: false,
      code: 'QUERY_ARCHIVED',
      message: `关联查询 ${code} 已归档，调度被阻断，不生成定时查询结果数据集`,
    }
  }
  return { ok: true, query }
}

/** 状态机：严格按 草稿 → 定时评审中 → 已启用 ⇄ 已暂停 推进。 */
export function allowedSchedulerActions(job: EntryRow): SchedulerAction[] {
  const status = String(job.status)
  return (Object.keys(SCHEDULER_ACTIONS) as SchedulerAction[]).filter((action) =>
    (SCHEDULER_ACTIONS[action].from as readonly string[]).includes(status),
  )
}

function nextRunAfter(job: EntryRow, from: Date): string {
  const next = nextCronOccurrence(jobText(job, '调度cron'), from)
  return next ? normalizeScheduledMinute(next) : ''
}

function cancelInflight(job: EntryRow, now: Date, reason: string): number {
  const at = minuteText(now)
  const runs = schedulerRuns()
  let cleaned = 0
  for (const run of runs) {
    if (run.jobId !== Number(job.id) || !isActiveRun(run.status)) continue
    run.status = '已取消'
    run.finishedAt = at
    run.durationMs = 0
    run.outcome = '取消'
    run.message = reason
    run.resultSetId = ''
    cleaned += 1
    appendEvent(
      {
        jobId: Number(job.id),
        jobCode: jobText(job, '作业编号'),
        at,
        type: '触发清理',
        fromStatus: String(job.status),
        toStatus: '已暂停',
        runId: run.runId,
        message: `调度点 ${run.scheduledAt} 的运行 ${run.runId} 因暂停被清理：${reason}`,
      },
      now,
    )
  }
  if (cleaned > 0) writeStore({ runs })
  return cleaned
}

export function changeSchedulerStatus(
  jobId: number,
  action: SchedulerAction,
  now: Date = new Date(),
): ActionResult {
  const job = jobById(jobId)
  if (!job) return { ok: false, message: `没有找到编号为 ${jobId} 的定时作业` }
  const rule = SCHEDULER_ACTIONS[action]
  if (!rule) return { ok: false, message: `定时作业没有登记「${action}」这个动作` }

  const current = String(job.status)
  if (!(rule.from as readonly string[]).includes(current)) {
    return {
      ok: false,
      message: `作业 ${jobText(job, '作业编号')} 当前为「${current}」，不能执行「${action}」；允许顺序：草稿 → 定时评审中 → 已启用 ⇄ 已暂停`,
    }
  }

  if (action === '启用定时') {
    const cronCheck = validateCron(jobText(job, '调度cron'))
    if (!cronCheck.ok) {
      return { ok: false, message: `调度cron 无效，不能启用：${cronCheck.message}` }
    }
    const link = resolveQuery(job)
    if (!link.ok) {
      return { ok: false, message: `${link.message}（可保留作业配置，修好查询后再启用）` }
    }
  }

  const at = minuteText(now)
  const order = ['草稿', '定时评审中', '已启用', '已暂停']
  let updated: EntryRow = {
    ...job,
    status: rule.to,
    pending: rule.to === '定时评审中',
    abnormal: rule.to === '已暂停',
    作业版本: Number(job['作业版本'] ?? 1) + 1,
    状态序号: order.indexOf(rule.to) + 1,
  }

  if (action === '暂停定时') {
    updated = {
      ...updated,
      暂停前状态: current,
      暂停原因: '手动暂停调度',
      下次运行时间: '',
      abnormal: true,
    }
    const cleaned = cancelInflight(job, now, '作业已暂停，旧的触发不再执行')
    appendEvent(
      {
        jobId,
        jobCode: jobText(job, '作业编号'),
        at,
        type: '状态流转',
        fromStatus: current,
        toStatus: rule.to,
        runId: '',
        message: `作业暂停，清空下次运行时间并清理未结束触发（${cleaned} 条）`,
      },
      now,
    )
  } else if (action === '启用定时') {
    // 从下一个有效调度点开始：暂停期间的时间点不补跑。
    const next = nextRunAfter(job, now)
    updated = {
      ...updated,
      下次运行时间: next,
      暂停原因: '',
      暂停前状态: '',
      恢复于: current === '已暂停' ? at : jobText(job, '恢复于'),
      失败原因: '',
      abnormal: false,
      pending: false,
    }
    appendEvent(
      {
        jobId,
        jobCode: jobText(job, '作业编号'),
        at,
        type: current === '已暂停' ? '恢复调度' : '启用调度',
        fromStatus: current,
        toStatus: rule.to,
        runId: '',
        message:
          current === '已暂停'
            ? `从下一个有效调度点 ${next} 开始，不补跑暂停期间的时间点`
            : `启用调度，下次运行 ${next}`,
      },
      now,
    )
  } else {
    updated = { ...updated, 下次运行时间: '' }
    appendEvent(
      {
        jobId,
        jobCode: jobText(job, '作业编号'),
        at,
        type: '状态流转',
        fromStatus: current,
        toStatus: rule.to,
        runId: '',
        message: '提交定时评审，评审通过前不参与调度',
      },
      now,
    )
  }

  saveJob(updated)
  return { ok: true, message: `作业 ${jobText(job, '作业编号')} 已${action}，当前状态「${rule.to}」` }
}

/** 调整调度cron 并立即重算下次运行时间；停用状态下只保存表达式，不产出下次时间。 */
export function updateJobCron(jobId: number, cron: string, now: Date = new Date()): DispatchOutcome {
  const job = jobById(jobId)
  if (!job) return { ok: false, message: `没有找到编号为 ${jobId} 的定时作业` }
  const text = String(cron ?? '').trim()
  const check = validateCron(text)
  if (!check.ok) return { ok: false, message: `调度cron 无效：${check.message}` }
  const enabled = String(job.status) === JOB_ENABLED
  const next = enabled ? nextRunAfter({ ...job, 调度cron: text }, now) : ''
  saveJob({
    ...job,
    调度cron: text,
    下次运行时间: next,
    作业版本: Number(job['作业版本'] ?? 1) + 1,
    abnormal: String(job['失败原因'] ?? '') !== '',
  })
  appendEvent(
    {
      jobId,
      jobCode: jobText(job, '作业编号'),
      at: minuteText(now),
      type: '调度调整',
      fromStatus: String(job.status),
      toStatus: String(job.status),
      runId: '',
      message: `调度cron 调整为「${text}」，${enabled ? `下次运行重算为 ${next}` : '作业未启用，下次运行时间保持为空'}`,
    },
    now,
  )
  return {
    ok: true,
    scheduledAt: next,
    message: `已更新调度cron「${text}」，${enabled ? `下次运行时间重算为 ${next}` : '作业未启用，不产生下次运行时间'}`,
  }
}

/** 显式重算 cron 与下次运行时间（跨夜、跨月一律由 cron 推导）。 */
export function recomputeSchedule(jobId: number, now: Date = new Date()): DispatchOutcome {
  const job = jobById(jobId)
  if (!job) return { ok: false, message: `没有找到编号为 ${jobId} 的定时作业` }
  if (String(job.status) !== JOB_ENABLED) {
    if (String(job['下次运行时间'] ?? '') !== '') {
      saveJob({ ...job, 下次运行时间: '' })
    }
    return {
      ok: true,
      message: `作业 ${jobText(job, '作业编号')} 未启用，下次运行时间保持为空`,
      scheduledAt: '',
    }
  }
  const check = validateCron(jobText(job, '调度cron'))
  if (!check.ok) {
    return { ok: false, message: `调度cron 无效：${check.message}` }
  }
  const lastRun = parseDateTime(jobText(job, '上次运行时间'))
  const anchor = lastRun && lastRun.getTime() > now.getTime() ? lastRun : now
  const next = nextRunAfter(job, anchor)
  saveJob({ ...job, 下次运行时间: next })
  return {
    ok: true,
    message: `已按 cron「${jobText(job, '调度cron')}」重算，下次运行 ${next || '（无）'}`,
    scheduledAt: next,
  }
}

/** 页面加载时校正所有作业的下次运行时间，暂停/评审状态一律清空。 */
export function recomputeAllSchedules(now: Date = new Date()): void {
  for (const job of jobRows()) {
    if (String(job.status) !== JOB_ENABLED) {
      if (String(job['下次运行时间'] ?? '') !== '') saveJob({ ...job, 下次运行时间: '' })
      continue
    }
    const check = validateCron(jobText(job, '调度cron'))
    if (!check.ok) continue
    const lastRun = parseDateTime(jobText(job, '上次运行时间'))
    const nextText = jobText(job, '下次运行时间')
    const next = parseDateTime(nextText)
    if (next && next.getTime() > now.getTime()) continue
    const anchor = lastRun && lastRun.getTime() > now.getTime() ? lastRun : now
    saveJob({ ...job, 下次运行时间: nextRunAfter(job, anchor) })
  }
}

function hash(input: string): number {
  let value = 0
  for (let index = 0; index < input.length; index += 1) {
    value = (value * 31 + input.charCodeAt(index)) % 100000
  }
  return value
}

function buildResultRows(
  job: EntryRow,
  query: EntryRow,
  scheduledAt: string,
): Record<string, string | number>[] {
  const name = String(query['脚本名称'] ?? jobText(job, '关联查询'))
  const seed = hash(`${jobText(job, '作业编号')}|${scheduledAt}|${query['脚本版本'] ?? ''}`)
  const day = scheduledAt.slice(0, 10)
  return [
    { 维度: name, 指标: '记录数', 数值: seed % 500, 统计时间: day },
    { 维度: name, 指标: '去重用户数', 数值: seed % 97, 统计时间: day },
    { 维度: name, 指标: '平均耗时毫秒', 数值: 40 + (seed % 120), 统计时间: day },
    { 维度: name, 指标: '异常记录数', 数值: seed % 3, 统计时间: day },
  ]
}

function slotIds(job: EntryRow, scheduledAt: string): { runId: string; resultSetId: string } {
  const token = scheduledAt.replace(' ', '-').replace(':', '')
  return {
    runId: `RUN-${token}-${job.id}`,
    resultSetId: `RSLT-${token}-${job.id}`,
  }
}

function findRunForSlot(jobId: number, scheduledAt: string): SchedulerRun | undefined {
  return schedulerRuns(jobId).find((run) => run.scheduledAt === scheduledAt)
}

function advanceNextRun(job: EntryRow, scheduledAt: string, now: Date): EntryRow {
  const following = nextCronOccurrence(
    jobText(job, '调度cron'),
    parseDateTime(scheduledAt) ?? now,
  )
  return { ...job, 下次运行时间: following ? normalizeScheduledMinute(following) : '' }
}

type SlotContext = {
  now: Date
  trigger: string
  overlap: string
  resultMode: string
}

type BaseRun = Omit<SchedulerRun, 'runId' | 'scheduledAt' | 'status' | 'outcome'>

function baseRun(
  job: EntryRow,
  scheduledAt: string,
  context: SlotContext,
  queryVersion: string,
): BaseRun {  return {
    jobId: Number(job.id),
    jobCode: jobText(job, '作业编号'),
    jobVersion: Number(job['作业版本'] ?? 1),
    jobStatus: String(job.status),
    queryCode: jobText(job, '关联查询'),
    queryVersion,
    cron: jobText(job, '调度cron'),
    trigger: context.trigger,
    overlap: context.overlap,
    duplicateAttempts: 1,
    createdAt: minuteText(context.now),
    startedAt: '',
    finishedAt: '',
    durationMs: 0,
    message: '',
    rowCount: 0,
    resultSetId: '',
  }
}

function rejectNotEnabled(
  job: EntryRow,
  scheduledAt: string,
  context: SlotContext,
  status: string,
): DispatchOutcome {
  const jobCode = jobText(job, '作业编号')
  appendEvent(
    {
      jobId: Number(job.id),
      jobCode,
      at: minuteText(context.now),
      type: '触发拒绝',
      fromStatus: status,
      toStatus: status,
      runId: '',
      message: `作业当前为「${status}」，${scheduledAt} 的触发在执行前被状态检查拒绝，不写结果数据集`,
    },
    context.now,
  )
  return {
    ok: false,
    code: 'JOB_NOT_ENABLED',
    scheduledAt,
    message: `作业 ${jobCode} 当前为「${status}」，已阻止生成调度结果（触发被拒绝）`,
  }
}

function recordBlocked(
  job: EntryRow,
  scheduledAt: string,
  context: SlotContext,
  message: string,
  code: string,
): DispatchOutcome {
  const ids = slotIds(job, scheduledAt)
  const run: SchedulerRun = {
    ...baseRun(job, scheduledAt, context, ''),
    runId: ids.runId,
    scheduledAt,
    status: '已阻断',
    outcome: '阻断',
    finishedAt: minuteText(context.now),
    message,
    resultSetId: '',
  }
  writeStore({ runs: [...schedulerRuns(), run] })
  appendEvent(
    {
      jobId: Number(job.id),
      jobCode: run.jobCode,
      at: minuteText(context.now),
      type: '调度阻断',
      fromStatus: String(job.status),
      toStatus: String(job.status),
      runId: run.runId,
      message: `${scheduledAt} 调度被阻断：${message}`,
    },
    context.now,
  )
  // 保留上次运行状态，只记录阻断原因；同时推进下次运行时间，避免同一调度点反复重试。
  saveJob({ ...advanceNextRun(job, scheduledAt, context.now), 失败原因: message })
  return { ok: false, code, runId: run.runId, scheduledAt, message }
}

function recordSkipped(
  job: EntryRow,
  scheduledAt: string,
  context: SlotContext,
  overlap: string,
  message: string,
  now: Date,
): SchedulerRun {
  const ids = slotIds(job, scheduledAt)
  const run: SchedulerRun = {
    ...baseRun(job, scheduledAt, { ...context, overlap }, ''),
    runId: ids.runId,
    scheduledAt,
    status: '已跳过',
    outcome: '跳过',
    finishedAt: minuteText(now),
    message,
  }
  writeStore({ runs: [...schedulerRuns(), run] })
  appendEvent(
    {
      jobId: Number(job.id),
      jobCode: run.jobCode,
      at: minuteText(now),
      type: '重叠跳过',
      fromStatus: String(job.status),
      toStatus: String(job.status),
      runId: run.runId,
      message: `${scheduledAt} ${message}`,
    },
    now,
  )
  return run
}

/**
 * 执行一个调度时间点。幂等：同一「作业 + 调度分钟」只会有一条运行记录，
 * 无论调用方是定时检查、按钮还是重复点击。
 */
export function executeScheduledSlot(
  jobId: number,
  scheduledAtInput: string,
  context: SlotContext,
): DispatchOutcome {
  const scheduledAt = normalizeScheduledMinute(scheduledAtInput)
  if (!scheduledAt) {
    return { ok: false, code: 'SLOT_INVALID', message: `调度时间点「${scheduledAtInput}」无效` }
  }
  const job = jobById(jobId)
  if (!job) return { ok: false, code: 'JOB_MISSING', message: `没有找到编号为 ${jobId} 的定时作业` }

  const status = String(job.status)
  // 第一道闸：暂停 / 评审 / 草稿状态直接挡住旧触发，不留下运行和结果。
  if (status !== JOB_ENABLED) {
    return rejectNotEnabled(job, scheduledAt, context, status)
  }

  // 幂等闸：同一调度点只认一条运行，重复触发只累计次数并写时间线说明。
  const existing = findRunForSlot(jobId, scheduledAt)
  if (existing) {
    const runs = schedulerRuns().map((run) =>
      run.runId === existing.runId
        ? { ...run, duplicateAttempts: run.duplicateAttempts + 1 }
        : run,
    )
    writeStore({ runs })
    appendEvent(
      {
        jobId,
        jobCode: jobText(job, '作业编号'),
        at: minuteText(context.now),
        type: '重复触发',
        fromStatus: status,
        toStatus: status,
        runId: existing.runId,
        message: `${scheduledAt} 已被 ${existing.runId} 占用（${existing.overlap}），本次触发合并，不新增运行`,
      },
      context.now,
    )
    return {
      ok: true,
      code: 'DUPLICATE',
      runId: existing.runId,
      resultSetId: existing.resultSetId,
      scheduledAt,
      message: `同一调度点 ${scheduledAt} 已执行过（${existing.runId}），重复触发已合并，未新增运行`,
    }
  }

  const link = resolveQuery(job)
  if (!link.ok) {
    return recordBlocked(job, scheduledAt, context, link.message, link.code)
  }

  // 重叠闸：同一作业已有未结束运行时，按作业配置等待或跳过。
  const active = schedulerRuns(jobId).find((run) => isActiveRun(run.status))
  if (active) {
    if (jobText(job, '重叠策略') === '跳过重叠') {
      const run = recordSkipped(
        job,
        scheduledAt,
        context,
        `跳过重叠：${active.runId} 仍在${active.status}`,
        `与 ${active.runId} 重叠，按「跳过重叠」策略只保留已有运行，不写结果数据集`,
        context.now,
      )
      saveJob(advanceNextRun(job, scheduledAt, context.now))
      return {
        ok: true,
        code: 'OVERLAP_SKIPPED',
        runId: run.runId,
        scheduledAt,
        message: `调度点 ${scheduledAt} 与 ${active.runId} 重叠，已记录为跳过，不写结果数据集`,
      }
    }
    // 排队串行：先落一条排队记录，等前一条结束再执行；时间线上能看出先后与等待。
    const ids = slotIds(job, scheduledAt)
    const notify = `排队串行：等待 ${active.runId}（${active.status}）完成后再执行`
    const queued: SchedulerRun = {
      ...baseRun(job, scheduledAt, { ...context, overlap: notify }, String(link.query['脚本版本'] ?? '')),
      runId: ids.runId,
      scheduledAt,
      status: '排队中',
      outcome: '排队',
      message: notify,
    }
    writeStore({ runs: [...schedulerRuns(), queued] })
    appendEvent(
      {
        jobId,
        jobCode: queued.jobCode,
        at: minuteText(context.now),
        type: '重叠排队',
        fromStatus: status,
        toStatus: status,
        runId: queued.runId,
        message: `${scheduledAt} 的运行进入排队：${notify}`,
      },
      context.now,
    )
    saveJob(advanceNextRun(job, scheduledAt, context.now))
    return {
      ok: true,
      code: 'OVERLAP_QUEUED',
      runId: queued.runId,
      scheduledAt,
      message: `调度点 ${scheduledAt} 与 ${active.runId} 重叠，按「排队串行」进入等待队列`,
    }
  }

  return completeRun(job, link.query, scheduledAt, context)
}

/** 把排队中的运行按先后顺序补齐，只处理前序已结束的记录。 */
export function drainQueuedRuns(now: Date = new Date()): DispatchOutcome[] {
  const outcomes: DispatchOutcome[] = []
  let guard = 0
  while (guard < MAX_CATCH_UP * 2) {
    guard += 1
    const runs = schedulerRuns()
    const queued = runs.filter((run) => run.status === '排队中')
    if (queued.length === 0) break
    let progressed = false
    for (const run of queued) {
      const job = jobById(run.jobId)
      if (!job) continue
      if (String(job.status) !== JOB_ENABLED) {
        const next = runs.map((item) =>
          item.runId === run.runId
            ? { ...item, status: '已取消', outcome: '取消', finishedAt: minuteText(now), message: '作业已不在启用状态，排队运行被取消' }
            : item,
        )
        writeStore({ runs: next })
        progressed = true
        continue
      }
      const earlierActive = schedulerRuns(run.jobId).some(
        (item) =>
          item.runId !== run.runId &&
          isActiveRun(item.status) &&
          (item.scheduledAt < run.scheduledAt ||
            (item.scheduledAt === run.scheduledAt && item.createdAt < run.createdAt) ||
            (item.scheduledAt === run.scheduledAt &&
              item.createdAt === run.createdAt &&
              item.runId < run.runId)),
      )
      if (earlierActive) continue
      const jobRow = jobById(run.jobId)
      if (!jobRow) continue
      const link = resolveQuery(jobRow)
      if (!link.ok) {
        const cleared = schedulerRuns().map((item) =>
          item.runId === run.runId
            ? {
                ...item,
                status: '已阻断',
                outcome: '阻断',
                finishedAt: minuteText(now),
                message: link.message,
              }
            : item,
        )
        writeStore({ runs: cleared })
        saveJob({ ...jobRow, 失败原因: link.message })
        progressed = true
        continue
      }
      const waiting = run.overlap.startsWith('排队串行') ? run.createdAt : run.scheduledAt
      outcomes.push(
        completeRun(jobRow, link.query, run.scheduledAt, {
          now,
          trigger: run.trigger,
          overlap: run.overlap,
          resultMode: jobText(jobRow, '结果处理'),
        }, run.runId, waiting),
      )
      progressed = true
      break
    }
    if (!progressed) break
  }
  return outcomes
}

function completeRun(
  job: EntryRow,
  query: EntryRow,
  scheduledAt: string,
  context: SlotContext,
  presetRunId?: string,
  waitingSince?: string,
): DispatchOutcome {
  const ids = slotIds(job, scheduledAt)
  const runId = presetRunId ?? ids.runId
  const created = minuteText(context.now)
  const waitStart = waitingSince ? parseDateTime(waitingSince) : null
  const slotDate = parseDateTime(scheduledAt)
  const startCandidate = waitStart && slotDate && waitStart.getTime() > slotDate.getTime() ? waitStart : slotDate
  const started = startCandidate ? normalizeScheduledMinute(startCandidate) : created
  const rows = buildResultRows(job, query, scheduledAt)
  const run: SchedulerRun = {
    ...baseRun(job, scheduledAt, context, String(query['脚本版本'] ?? '')),
    runId,
    scheduledAt,
    status: '已完成',
    outcome: '成功',
    startedAt: started,
    finishedAt: created,
    durationMs: Math.max(0, (parseDateTime(created)?.getTime() ?? 0) - (parseDateTime(started)?.getTime() ?? 0)),
    message: `调度完成，写入结果数据集 ${ids.resultSetId}`,
    rowCount: rows.length,
    resultSetId: ids.resultSetId,
  }

  const resultSet: SchedulerResultSet = {
    resultSetId: ids.resultSetId,
    runId,
    jobId: Number(job.id),
    jobCode: run.jobCode,
    jobVersion: run.jobVersion,
    queryCode: run.queryCode,
    queryName: String(query['脚本名称'] ?? ''),
    queryVersion: run.queryVersion,
    cron: run.cron,
    scheduledAt,
    producedAt: created,
    rowCount: rows.length,
    rows,
  }

  const existingResults = schedulerResultSets()
  const appendMode = jobText(job, '结果处理') === '追加写结果集'
  const results = appendMode ? [...existingResults, resultSet] : [resultSet]
  // 覆盖写：清掉该作业的旧结果集，只保留本次；追加写：保留历史。
  const replacedJobs = appendMode ? [] : [Number(job.id)]

  writeStore({ runs: [...schedulerRuns(), run], results }, replacedJobs)
  appendEvent(
    {
      jobId: Number(job.id),
      jobCode: run.jobCode,
      at: created,
      type: '结果生成',
      fromStatus: String(job.status),
      toStatus: String(job.status),
      runId: run.runId,
      message: `${scheduledAt} 调度完成（${context.overlap}），结果数据集 ${resultSet.resultSetId}（${rows.length} 行）`,
    },
    context.now,
  )

  saveJob({
    ...advanceNextRun(job, scheduledAt, context.now),
    上次运行时间: scheduledAt,
    上次运行状态: '已完成',
    上次运行编号: run.runId,
    上次成功时间: created,
    失败原因: '',
  })

  return {
    ok: true,
    code: 'RUN_COMPLETED',
    runId,
    resultSetId: resultSet.resultSetId,
    scheduledAt,
    message: `作业 ${run.jobCode} 在 ${scheduledAt} 调度完成，结果数据集 ${resultSet.resultSetId} 已写入`,
  }
}

function dueSlots(job: EntryRow, now: Date): string[] {
  const cron = jobText(job, '调度cron')
  let cursor = parseDateTime(jobText(job, '下次运行时间'))
  if (!cursor) {
    // 没有下次运行时间（刚启用或旧数据）时不追溯历史，只把下次运行时间补出来。
    const upcoming = nextCronOccurrence(cron, now)
    if (upcoming) saveJob({ ...job, 下次运行时间: normalizeScheduledMinute(upcoming) })
    return []
  }
  if (cursor.getTime() > now.getTime()) return []
  const due: string[] = []
  let guard = 0
  while (cursor && cursor.getTime() <= now.getTime() && guard < MAX_CATCH_UP) {
    due.push(normalizeScheduledMinute(cursor))
    const following = nextCronOccurrence(cron, cursor)
    if (!following) break
    cursor = following
    guard += 1
  }
  return due
}

/**
 * 调度检查：只处理已启用作业，且只处理到期的调度点。
 * 重叠策略由作业的「重叠策略」决定：排队串行逐点补齐，跳过重叠只执行最近一个点，
 * 其余落一条已跳过记录，时间线上能解释「为什么这个点没有结果」。
 */
export function dispatchDueJobs(now: Date = new Date(), jobIds?: number[]): DispatchOutcome[] {
  const outcomes: DispatchOutcome[] = []
  drainQueuedRuns(now)
  const jobs = jobRows().filter((job) => jobIds === undefined || jobIds.includes(Number(job.id)))
  for (const job of jobs) {
    if (String(job.status) !== JOB_ENABLED) continue
    const cronCheck = validateCron(jobText(job, '调度cron'))
    if (!cronCheck.ok) {
      outcomes.push({
        ok: false,
        code: 'CRON_INVALID',
        message: `作业 ${jobText(job, '作业编号')} 的调度cron 无效：${cronCheck.message}`,
      })
      continue
    }
    const due = dueSlots(job, now)
    if (due.length === 0) continue

    if (jobText(job, '重叠策略') === '跳过重叠' && due.length > 1) {
      for (const slot of due.slice(0, -1)) {
        if (findRunForSlot(Number(job.id), slot)) continue
        recordSkipped(
          job,
          slot,
          { now, trigger: '定时触发', overlap: '', resultMode: jobText(job, '结果处理') },
          '跳过重叠：错过多个调度点，只执行最近一个',
          `错过 ${slot} 的调度点，按「跳过重叠」策略不再补跑`,
          now,
        )
        outcomes.push({
          ok: true,
          code: 'OVERLAP_SKIPPED',
          runId: slotIds(job, slot).runId,
          scheduledAt: slot,
          message: `${slot} 已按跳过重叠记录，不写结果数据集`,
        })
      }
      const last = due[due.length - 1]
      const latestJob = jobById(Number(job.id)) ?? job
      outcomes.push(
        executeScheduledSlot(Number(job.id), last, {
          now,
          trigger: '定时触发',
          overlap: '跳过重叠：错过多个调度点，只执行最近一个',
          resultMode: jobText(latestJob, '结果处理'),
        }),
      )
      continue
    }

    due.forEach((slot, index) => {
      const fresh = jobById(Number(job.id))
      if (!fresh) return
      outcomes.push(
        executeScheduledSlot(Number(job.id), slot, {
          now,
          trigger: '定时触发',
          overlap:
            index === 0
              ? '无重叠'
              : `排队串行：等待 ${slotIds(job, due[index - 1]).runId} 完成后执行`,
          resultMode: jobText(fresh, '结果处理'),
        }),
      )
    })
  }
  drainQueuedRuns(now)
  return outcomes
}

/** 手工触发某个调度点（验收用：同一时间点连续触发两次）。 */
export function triggerScheduledSlot(
  jobId: number,
  scheduledAt: string,
  now: Date = new Date(),
): DispatchOutcome {
  const job = jobById(jobId)
  if (!job) return { ok: false, code: 'JOB_MISSING', message: `没有找到编号为 ${jobId} 的定时作业` }
  return executeScheduledSlot(jobId, scheduledAt, {
    now,
    trigger: '手工触发',
    overlap: '无重叠',
    resultMode: jobText(job, '结果处理'),
  })
}

export type SchedulerResultExport = {
  filename: string
  content: string
  resultSets: SchedulerResultSet[]
  rowCount: number
}

/**
 * 数据导出与定时查询结果数据集同源：从结果集读取，带上作业编号、作业版本、
 * 关联查询与查询版本，方便逐项回查这次运行的来源。
 */
export function exportScheduledResults(): SchedulerResultExport {
  const results = schedulerResultSets()
  const runs = schedulerRuns()
  const header = [
    '结果集编号',
    '作业运行编号',
    '作业编号',
    '作业版本',
    '关联查询',
    '查询名称',
    '查询版本',
    '调度cron',
    '调度时间',
    '生成时间',
    '结果行数',
    '运行状态',
    '维度',
    '指标',
    '数值',
    '统计时间',
  ]
  const lines = [header.join(',')]
  let rowCount = 0
  for (const result of results) {
    const run = runs.find((item) => item.runId === result.runId)
    for (const row of result.rows) {
      rowCount += 1
      lines.push(
        [
          result.resultSetId,
          result.runId,
          result.jobCode,
          result.jobVersion,
          result.queryCode,
          result.queryName,
          result.queryVersion,
          result.cron,
          result.scheduledAt,
          result.producedAt,
          result.rowCount,
          run?.status ?? '已完成',
          row['维度'] ?? '',
          row['指标'] ?? '',
          row['数值'] ?? '',
          row['统计时间'] ?? '',
        ].join(','),
      )
    }
  }
  return {
    filename: '定时查询结果数据集.csv',
    content: `﻿${lines.join('\n')}`,
    resultSets: results,
    rowCount,
  }
}
