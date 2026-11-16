import type { SchedulerResultSet, SchedulerRun } from './types'

/** 定时作业运行与结果数据集的初始记录：首次打开时播种，之后以浏览器存储为准。 */

export type SchedulerEvent = {
  eventId: string
  jobId: number
  jobCode: string
  at: string
  type: string
  fromStatus: string
  toStatus: string
  runId: string
  message: string
}

export const SEED_SCHEDULER_RUNS: SchedulerRun[] = [
  {
    runId: 'RUN-20261115-2315-3',
    jobId: 3,
    jobCode: 'SCHE-0003',
    jobVersion: 2,
    jobStatus: '已启用',
    queryCode: 'QUER-0003',
    queryVersion: 'v3.0',
    cron: '15 23 * * *',
    scheduledAt: '2026-11-15 23:15',
    status: '已完成',
    trigger: '定时触发',
    overlap: '无重叠',
    duplicateAttempts: 1,
    createdAt: '2026-11-15 23:15',
    startedAt: '2026-11-15 23:15',
    finishedAt: '2026-11-15 23:15',
    durationMs: 860,
    outcome: '成功',
    message: '调度完成，写入结果数据集 RSLT-20261115-2315-3',
    rowCount: 4,
    resultSetId: 'RSLT-20261115-2315-3',
  },
]

export const SEED_SCHEDULER_RESULT_SETS: SchedulerResultSet[] = [
  {
    resultSetId: 'RSLT-20261115-2315-3',
    runId: 'RUN-20261115-2315-3',
    jobId: 3,
    jobCode: 'SCHE-0003',
    jobVersion: 2,
    queryCode: 'QUER-0003',
    queryName: '查询编辑器样例3',
    queryVersion: 'v3.0',
    cron: '15 23 * * *',
    scheduledAt: '2026-11-15 23:15',
    producedAt: '2026-11-15 23:15',
    rowCount: 4,
    rows: [
      { 维度: '查询编辑器样例3', 指标: '记录数', 数值: 128, 统计时间: '2026-11-15' },
      { 维度: '查询编辑器样例3', 指标: '去重用户数', 数值: 42, 统计时间: '2026-11-15' },
      { 维度: '查询编辑器样例3', 指标: '平均耗时毫秒', 数值: 86, 统计时间: '2026-11-15' },
      { 维度: '查询编辑器样例3', 指标: '异常记录数', 数值: 0, 统计时间: '2026-11-15' },
    ],
  },
]

export const SEED_SCHEDULER_EVENTS: SchedulerEvent[] = [
  {
    eventId: 'EVT-SEED-1',
    jobId: 3,
    jobCode: 'SCHE-0003',
    at: '2026-11-15 23:15',
    type: '结果生成',
    fromStatus: '已启用',
    toStatus: '已启用',
    runId: 'RUN-20261115-2315-3',
    message: '定时触发完成，生成结果数据集 RSLT-20261115-2315-3',
  },
]
