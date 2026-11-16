<template>
  <section class="page" data-module="schedulerjob">
    <header class="page-head">
      <div>
        <h2>定时任务管理</h2>
        <p class="page-desc">作业编号、关联查询、下次运行时间与上次运行状态逐项可回查；暂停与查询失效都会阻断结果生成。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="runDue">执行到期调度</button>
        <button class="btn" type="button" @click="recomputeAll">重算下次运行</button>
        <button class="btn" type="button" @click="exportResults">导出定时查询结果数据集</button>
      </div>
    </header>

    <p v-if="notice" class="notice" :class="{ bad: noticeBad }">{{ notice }}</p>

    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
      <span class="tab-hint">作业面板与运行详情读取同一份调度结果</span>
    </div>

    <template v-if="activeTab === 'jobs'">
      <div class="stat-row">
        <article v-for="item in stats" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>

      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
        <span class="legend-item">运行记录：{{ runs.length }} 条</span>
        <span class="legend-item">结果数据集：{{ resultSets.length }} 份</span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>关联查询状态</th>
            <th>当前状态</th>
            <th>可执行动作</th>
            <th>运行详情</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-selected': selectedJobId === Number(row.id) }">
            <td v-for="column in columns" :key="column">{{ display(row, column) }}</td>
            <td>
              <span :class="queryState(row).ok ? 'tag ok' : 'tag bad'">
                {{ queryState(row).ok ? queryState(row).label : queryState(row).label }}
              </span>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in allowedActions(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <button class="link" type="button" @click="recomputeOne(row)">重算调度</button>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="inspect(row)">查看</button>
              <button class="link" type="button" @click="triggerSlot(row)">触发调度点</button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 4" class="empty-state">暂无定时任务数据，可先登记定时作业</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条定时作业记录</span>
        <span>{{ errorMessage }}</span>
      </footer>
    </template>

    <template v-else>
      <div class="detail-head">
        <label class="filter-item">
          <span>选择作业</span>
          <select v-model.number="selectedJobId">
            <option v-for="row in allJobs" :key="String(row.id)" :value="Number(row.id)">
              {{ row['作业编号'] }} · {{ row['关联查询'] }}
            </option>
          </select>
        </label>
        <label class="filter-item">
          <span>手工触发的调度点</span>
          <input v-model="manualSlot" type="datetime-local" />
        </label>
        <label class="filter-item">
          <span>调度cron（修改后立即重算）</span>
          <input v-model="cronDraft" placeholder="分 时 日 月 星期" />
        </label>
        <button class="btn" type="button" @click="saveCron">保存 cron</button>
        <button class="btn" type="button" @click="triggerSlot(selectedJob)">在同一调度点触发</button>
        <button class="btn ghost" type="button" @click="runDue">执行到期调度</button>
      </div>

      <template v-if="selectedJob">
        <div class="stat-row">
          <article class="stat-card">
            <span class="stat-label">作业编号 / 状态</span>
            <strong class="stat-value small">{{ selectedJob['作业编号'] }} · {{ selectedJob.status }}</strong>
            <span class="stat-note">作业版本 {{ selectedJob['作业版本'] ?? 1 }} · 状态序号 {{ selectedJob['状态序号'] ?? '—' }}</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">关联查询</span>
            <strong class="stat-value small">{{ selectedJob['关联查询'] }}</strong>
            <span class="stat-note">{{ queryState(selectedJob).label }}</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">调度cron / 下次运行时间</span>
            <strong class="stat-value small">{{ selectedJob['调度cron'] }}</strong>
            <span class="stat-note">下次运行：{{ selectedJob['下次运行时间'] || '—（未启用）' }}</span>
          </article>
          <article class="stat-card">
            <span class="stat-label">上次运行时间 / 状态</span>
            <strong class="stat-value small">{{ selectedJob['上次运行时间'] || '—' }}</strong>
            <span class="stat-note">
              状态：{{ selectedJob['上次运行状态'] }}{{ selectedJob['上次运行编号'] ? ` · ${selectedJob['上次运行编号']}` : '' }}
            </span>
          </article>
        </div>

        <p v-if="selectedJob['暂停原因']" class="notice">暂停原因：{{ selectedJob['暂停原因'] }}（暂停前状态 {{ selectedJob['暂停前状态'] || '—' }}，恢复于 {{ selectedJob['恢复于'] || '—' }}）</p>
        <p v-if="selectedJob['失败原因']" class="notice bad">阻断/失败原因：{{ selectedJob['失败原因'] }}</p>

        <h3 class="section-title">运行时间线（同一调度点只出现一次）</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>运行编号</th><th>调度时间点</th><th>状态</th><th>重叠处理</th><th>触发来源</th>
              <th>作业版本</th><th>关联查询版本</th><th>重复触发次数</th><th>结果集</th><th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="run in jobRuns" :key="run.runId">
              <td>{{ run.runId }}</td>
              <td>{{ run.scheduledAt }}</td>
              <td><span class="tag" :class="runTagClass(run)">{{ run.status }}</span></td>
              <td>{{ run.overlap }}</td>
              <td>{{ run.trigger }}</td>
              <td>{{ run.jobVersion }}</td>
              <td>{{ run.queryVersion || '—' }}</td>
              <td>{{ run.duplicateAttempts }}</td>
              <td>{{ run.resultSetId || '—' }}</td>
              <td>{{ run.message }}</td>
            </tr>
            <tr v-if="!jobRuns.length">
              <td colspan="10" class="empty-state">该作业还没有运行记录</td>
            </tr>
          </tbody>
        </table>

        <h3 class="section-title">定时查询结果数据集（导出读取同一份数据）</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>结果集编号</th><th>运行编号</th><th>作业编号</th><th>作业版本</th>
              <th>关联查询</th><th>查询版本</th><th>调度时间</th><th>生成时间</th><th>行数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="result in jobResults" :key="result.resultSetId">
              <td>{{ result.resultSetId }}</td>
              <td>{{ result.runId }}</td>
              <td>{{ result.jobCode }}</td>
              <td>{{ result.jobVersion }}</td>
              <td>{{ result.queryCode }}（{{ result.queryName }}）</td>
              <td>{{ result.queryVersion }}</td>
              <td>{{ result.scheduledAt }}</td>
              <td>{{ result.producedAt }}</td>
              <td>{{ result.rowCount }}</td>
            </tr>
            <tr v-if="!jobResults.length">
              <td colspan="9" class="empty-state">该作业还没有结果数据集</td>
            </tr>
          </tbody>
        </table>

        <h3 class="section-title">状态与调度事件</h3>
        <table class="data-table">
          <thead>
            <tr><th>时间</th><th>类型</th><th>状态流转</th><th>运行编号</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr v-for="event in jobEvents" :key="event.eventId">
              <td>{{ event.at }}</td>
              <td>{{ event.type }}</td>
              <td>{{ event.fromStatus }} → {{ event.toStatus }}</td>
              <td>{{ event.runId || '—' }}</td>
              <td>{{ event.message }}</td>
            </tr>
            <tr v-if="!jobEvents.length">
              <td colspan="5" class="empty-state">暂无事件记录</td>
            </tr>
          </tbody>
        </table>
      </template>
      <p v-else class="empty-state">还没有可查看的定时作业</p>

      <footer class="page-foot">
        <span>{{ errorMessage }}</span>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import {
  allowedSchedulerActions,
  dispatchDueJobs,
  exportScheduledResults,
  recomputeAllSchedules,
  recomputeSchedule,
  resolveQuery,
  schedulerEvents,
  schedulerResultSets,
  schedulerRuns,
  triggerScheduledSlot,
  updateJobCron,
} from '@/api/scheduler-service'
import type { SchedulerRun } from '@/data/types'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('schedulerjob')
const columns = [
  '作业编号',
  '关联查询',
  '调度cron',
  '结果处理',
  '通知邮箱',
  '上次运行时间',
  '上次运行状态',
  '下次运行时间',
  '作业版本',
]
const statuses = ['草稿', '定时评审中', '已启用', '已暂停']
const filterFields = ['作业编号', '关联查询', '调度cron']
const tabs: { key: 'jobs' | 'detail'; label: string }[] = [
  { key: 'jobs', label: '作业面板' },
  { key: 'detail', label: '运行详情' },
]

const activeTab = ref<'jobs' | 'detail'>('jobs')
const rows = ref<EntryRow[]>([])
const allJobs = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const noticeBad = ref(false)
const filters = ref<Record<string, string>>({})
const runs = ref<SchedulerRun[]>([])
const resultSets = ref(schedulerResultSets())
const selectedJobId = ref(0)
const manualSlot = ref('')
const cronDraft = ref('')

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: allJobs.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '定时作业总数', value: allJobs.value.length },
  { label: '已启用作业', value: allJobs.value.filter((row) => String(row.status) === '已启用').length },
  { label: '评审中作业', value: allJobs.value.filter((row) => String(row.status) === '定时评审中').length },
])

const selectedJob = computed(() => allJobs.value.find((row) => Number(row.id) === selectedJobId.value))
const jobRuns = computed(() => runs.value.filter((run) => run.jobId === selectedJobId.value))
const jobResults = computed(() => resultSets.value.filter((item) => item.jobId === selectedJobId.value))
const jobEvents = computed(() => schedulerEvents(selectedJobId.value))

const SCHEDULER_ORDER = ['草稿', '定时评审中', '已启用', '已暂停']

function display(row: EntryRow, column: string): string {
  const value = row[column]
  return value === '' || value === undefined || value === null ? '—' : String(value)
}

function allowedActions(row: EntryRow) {
  return allowedSchedulerActions(row)
}

function queryState(row: EntryRow): { ok: boolean; label: string } {
  const link = resolveQuery(row)
  if (!link.ok) return { ok: false, label: link.code === 'QUERY_ARCHIVED' ? '已归档（阻断）' : '查询缺失（阻断）' }
  return {
    ok: true,
    label: `${link.query.status}${link.query['脚本版本'] ? ` · ${link.query['脚本版本']}` : ''}`,
  }
}

function runTagClass(run: SchedulerRun): string {
  if (run.status === '已完成') return 'ok'
  if (run.status === '已阻断' || run.status === '已取消') return 'bad'
  return 'warn'
}

function setNotice(message: string, bad = false): void {
  notice.value = message
  noticeBad.value = bad
}

function reload(): void {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    allJobs.value = listEntries(meta.key).items
    runs.value = schedulerRuns()
    resultSets.value = schedulerResultSets()
    if (!selectedJobId.value && allJobs.value.length) {
      selectedJobId.value = Number(allJobs.value[0].id)
    }
    if (selectedJob.value) {
      cronDraft.value = String(selectedJob.value['调度cron'] ?? '')
      if (!manualSlot.value) {
        manualSlot.value = toInput(selectedJob.value['下次运行时间'] || Date.now())
      }
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '定时任务列表读取失败'
  }
}

function toInput(value: string | number | true): string {
  const date = new Date(typeof value === 'boolean' ? Date.now() : value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (item: number) => String(item).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function resetFilters(): void {
  filters.value = {}
  reload()
}

function runAction(action: string, row: EntryRow): void {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  setNotice(result.message, !result.ok)
  reload()
}

function recomputeOne(row: EntryRow): void {
  const result = recomputeSchedule(Number(row.id))
  setNotice(result.message, !result.ok)
  reload()
}

function recomputeAll(): void {
  recomputeAllSchedules()
  const outcomes = dispatchDueJobs()
  setNotice(
    outcomes.length
      ? outcomes.map((item) => item.message).join('；')
      : '已按 cron 重算所有作业的下次运行时间',
    outcomes.some((item) => !item.ok),
  )
  reload()
}

function runDue(): void {
  const outcomes = dispatchDueJobs()
  if (!outcomes.length) {
    setNotice('当前没有到期且可执行的调度点（暂停作业与无效 cron 不会生成结果）')
  } else {
    setNotice(outcomes.map((item) => item.message).join('；'), outcomes.every((item) => !item.ok))
  }
  reload()
}

function inspect(row: EntryRow): void {
  selectedJobId.value = Number(row.id)
  cronDraft.value = String(row['调度cron'] ?? '')
  manualSlot.value = toInput(row['下次运行时间'] || Date.now())
  activeTab.value = 'detail'
}

function saveCron(): void {
  if (!selectedJob.value) {
    setNotice('请先选择作业', true)
    return
  }
  const result = updateJobCron(Number(selectedJob.value.id), cronDraft.value)
  setNotice(result.message, !result.ok)
  reload()
}

function triggerSlot(row: EntryRow | undefined): void {
  if (!row) {
    setNotice('请先选择作业', true)
    return
  }
  if (!manualSlot.value) {
    setNotice('请先填写要触发的调度时间点', true)
    return
  }
  const result = triggerScheduledSlot(Number(row.id), manualSlot.value)
  setNotice(result.message, !result.ok)
  selectedJobId.value = Number(row.id)
  activeTab.value = 'detail'
  reload()
}

function exportResults(): void {
  const payload = exportScheduledResults()
  const blob = new Blob([payload.content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = payload.filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  setNotice(
    payload.resultSets.length
      ? `已导出 ${payload.resultSets.length} 份结果数据集共 ${payload.rowCount} 行，含作业编号与查询版本`
      : '当前没有可导出的定时查询结果数据集',
    payload.resultSets.length === 0,
  )
}

onMounted(() => {
  recomputeAllSchedules()
  reload()
})
</script>

<style scoped>
.tab-bar { display: flex; align-items: center; gap: 8px; margin: 8px 0 12px; }
.tab { border: 1px solid var(--border); background: #fff; border-radius: 6px; padding: 6px 14px; cursor: pointer; }
.tab.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.tab-hint { color: var(--muted); font-size: 12px; }
.notice { background: #eef6ff; border: 1px solid #bcd7ff; border-radius: 6px; padding: 8px 12px; font-size: 13px; }
.notice.bad { background: #fef3f2; border-color: #f0b7b1; color: #b42318; }
.detail-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin-bottom: 12px; }
.section-title { font-size: 14px; margin: 18px 0 8px; }
.stat-value.small { font-size: 15px; }
.stat-note { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; }
.row-selected { background: #eef6ff; }
.tag { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 12px; background: #eef2f7; }
.tag.ok { background: #e7f6ec; color: #1a7f37; }
.tag.bad { background: #fdecea; color: #b42318; }
.tag.warn { background: #fff4e5; color: #b25e09; }
.notice + .notice { margin-top: 6px; }
</style>
