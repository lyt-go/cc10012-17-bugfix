<template>
  <section class="page" data-module="exporttask">
    <header class="page-head">
      <div>
        <h2>数据导出管理</h2>
        <p class="page-desc">导出读取与定时任务同源的定时查询结果数据集，并保留作业编号、作业版本与关联查询版本。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记导出任务</button>
        <button class="btn" type="button" @click="exportResultSets">导出结果数据集</button>
        <button class="btn" type="button" @click="exportRows">导出数据导出清单</button>
      </div>
    </header>

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
      <span class="legend-item">结果数据集：{{ resultSets.length }} 份 · {{ resultRowCount }} 行</span>
    </p>

    <p v-if="notice" class="notice" :class="{ bad: noticeBad }">{{ notice }}</p>

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
          <th>作业编号</th>
          <th>关联查询版本</th>
          <th>运行时间</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ lineage(row)?.jobCode ?? '—' }}</td>
          <td>{{ lineage(row)?.queryVersion || '—' }}</td>
          <td>{{ lineage(row)?.scheduledAt ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 5" class="empty-state">暂无数据导出数据，可先登记导出任务</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">定时查询结果数据集（与定时任务同源）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>结果集编号</th><th>运行编号</th><th>作业编号</th><th>作业版本</th>
          <th>关联查询</th><th>查询版本</th><th>调度cron</th><th>调度时间</th>
          <th>生成时间</th><th>行数</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="result in resultSets" :key="result.resultSetId">
          <td>{{ result.resultSetId }}</td>
          <td>{{ result.runId }}</td>
          <td>{{ result.jobCode }}</td>
          <td>{{ result.jobVersion }}</td>
          <td>{{ result.queryCode }}</td>
          <td>{{ result.queryVersion }}</td>
          <td>{{ result.cron }}</td>
          <td>{{ result.scheduledAt }}</td>
          <td>{{ result.producedAt }}</td>
          <td>{{ result.rowCount }}</td>
        </tr>
        <tr v-if="!resultSets.length">
          <td colspan="10" class="empty-state">还没有定时查询结果数据集，先到定时任务里执行到期调度</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条数据导出记录</span>
      <span class="error-text">{{ errorMessage || notice }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  exportScheduledResults,
  lineageForTask,
  schedulerResultSets,
} from '@/api/scheduler-service'
import type { EntryRow, SchedulerResultSet } from '@/data/types'

const meta = moduleMeta('exporttask')
const columns = ["任务编号", "数据来源", "导出格式", "导出字段", "筛选条件", "最大行数", "压缩加密", "导出状态"]
const actions = ["提交导出", "启动导出", "取消导出"]
const statuses = ["草稿", "导出排队中", "导出中", "已完成", "已取消"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const noticeBad = ref(false)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const resultSets = ref<SchedulerResultSet[]>([])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '导出任务总数', value: rows.value.length },
  { label: '已完成任务', value: rows.value.filter((row) => String(row.status) === '已完成').length },
  { label: '排队中任务', value: rows.value.filter((row) => String(row.status) === '导出排队中').length },
])
const resultRowCount = computed(() => resultSets.value.reduce((sum, item) => sum + item.rowCount, 0))

function lineage(row: EntryRow) {
  return lineageForTask(row)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function exportResultSets() {
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
      ? `已导出 ${payload.resultSets.length} 份结果数据集共 ${payload.rowCount} 行，含作业编号、作业版本与查询版本`
      : '当前没有可导出的定时查询结果数据集',
    payload.resultSets.length === 0,
  )
}

function openCreate() {
  setNotice('导出任务登记入口尚未接入审批流', true)
}

function setNotice(message: string, bad = false) {
  notice.value = message
  noticeBad.value = bad
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    setNotice(result.message, true)
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    resultSets.value = schedulerResultSets()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '数据导出列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.section-title { font-size: 14px; margin: 18px 0 8px; }
.notice { background: #eef6ff; border: 1px solid #bcd7ff; border-radius: 6px; padding: 8px 12px; font-size: 13px; }
.notice.bad { background: #fef3f2; border-color: #f0b7b1; color: #b42318; }
</style>
