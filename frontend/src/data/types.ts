/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 定时作业的一次调度运行；同一「作业 + 调度时间点」最多一条记录。 */
export type SchedulerRun = {
  runId: string
  jobId: number
  jobCode: string
  /** 调度时的作业版本，用于和导出侧对齐 */
  jobVersion: number
  jobStatus: string
  queryCode: string
  queryVersion: string
  cron: string
  /** 归一化到分钟的调度时间点，是去重键的一部分 */
  scheduledAt: string
  /** 排队中 / 运行中 / 已完成 / 已阻断 / 已跳过 / 已取消 */
  status: string
  trigger: string
  /** 重叠调度时是排队执行还是跳过 */
  overlap: string
  duplicateAttempts: number
  createdAt: string
  startedAt: string
  finishedAt: string
  durationMs: number
  outcome: string
  message: string
  rowCount: number
  resultSetId: string
}

/** 定时查询结果数据集：导出的唯一数据源，保留作业与查询版本的来源链。 */
export type SchedulerResultSet = {
  resultSetId: string
  runId: string
  jobId: number
  jobCode: string
  jobVersion: number
  queryCode: string
  queryName: string
  queryVersion: string
  cron: string
  scheduledAt: string
  producedAt: string
  rowCount: number
  rows: Record<string, string | number>[]
}

