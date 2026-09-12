<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
} from 'vue'
import { defaultOceanSettings, type OceanSettings } from '../domain/ocean'
import type { OceanRuntime } from '../engine/babylon/ocean/createOcean'
import OceanControlPanel from './OceanControlPanel.vue'
import { oceanControlGroups } from './oceanControls'

const presetKey = 'age-of-exploration:ocean-preset:v1'
const values = reactive<OceanSettings>({ ...defaultOceanSettings })
const canvas = ref<HTMLCanvasElement>()
const runtime = shallowRef<OceanRuntime>()
const ready = ref(false)
const error = ref('')
const notice = ref('')
const history = ref<OceanSettings[]>([])
const hasSavedPreset = ref(false)
const canUndo = computed(() => history.value.length > 0)
let alive = true
let noticeTimer: ReturnType<typeof setTimeout> | undefined

const controls = oceanControlGroups.flatMap((group) => [
  ...group.controls,
  ...(group.children?.flatMap((child) => child.controls) ?? []),
])
const controlsByKey = new Map(controls.map((control) => [control.key, control]))

function snapshot(): OceanSettings {
  return { ...values }
}

function remember() {
  history.value.push(snapshot())
  if (history.value.length > 80) history.value.shift()
}

function apply(next: OceanSettings) {
  Object.assign(values, next)
  runtime.value?.update(values)
}

function updateSetting(
  key: keyof OceanSettings,
  value: string | number | boolean,
) {
  if (values[key] === value) return
  remember()
  ;(values as Record<keyof OceanSettings, string | number | boolean>)[key] =
    value
  runtime.value?.update(values)
}

function resetControl(key: keyof OceanSettings) {
  updateSetting(key, defaultOceanSettings[key])
}

function resetGroup(keys: Array<keyof OceanSettings>) {
  if (keys.every((key) => values[key] === defaultOceanSettings[key])) return
  remember()
  for (const key of keys) {
    ;(values as Record<keyof OceanSettings, string | number | boolean>)[key] =
      defaultOceanSettings[key]
  }
  runtime.value?.update(values)
}

function resetAll() {
  remember()
  apply({ ...defaultOceanSettings })
  showNotice('已恢复全部默认参数')
}

function undo() {
  const previous = history.value.pop()
  if (previous) apply(previous)
}

function showNotice(message: string) {
  notice.value = message
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), 2200)
}

function savePreset() {
  localStorage.setItem(presetKey, JSON.stringify(snapshot()))
  hasSavedPreset.value = true
  showNotice('当前参数已保存到浏览器')
}

function parseSettings(source: unknown): OceanSettings {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('配置必须是一个 JSON 对象')
  }

  const result = { ...defaultOceanSettings }
  const record = source as Record<string, unknown>
  for (const rawKey of Object.keys(defaultOceanSettings)) {
    const key = rawKey as keyof OceanSettings
    if (!(key in record)) continue
    const candidate = record[key]
    const fallback = defaultOceanSettings[key]
    if (typeof candidate !== typeof fallback) {
      throw new Error(`参数 ${key} 的类型不正确`)
    }
    const control = controlsByKey.get(key)
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate))
        throw new Error(`参数 ${key} 必须是有限数值`)
      if (control?.min !== undefined) {
        const invalid = control.exclusiveMin
          ? candidate <= control.min
          : candidate < control.min
        if (invalid) throw new Error(`参数 ${key} 小于允许范围`)
      }
      if (control?.max !== undefined && candidate > control.max) {
        throw new Error(`参数 ${key} 大于允许范围`)
      }
      if (control?.integer && !Number.isInteger(candidate)) {
        throw new Error(`参数 ${key} 必须是整数`)
      }
    }
    if (
      typeof candidate === 'string' &&
      control?.type === 'color' &&
      !/^#[0-9a-fA-F]{6}$/.test(candidate)
    ) {
      throw new Error(`参数 ${key} 必须是 #RRGGBB 色值`)
    }
    if (
      typeof candidate === 'string' &&
      control?.type === 'select' &&
      !control.options?.some((option) => option.value === candidate)
    ) {
      throw new Error(`参数 ${key} 不是可用选项`)
    }
    ;(result as Record<keyof OceanSettings, unknown>)[key] = candidate
  }
  return result
}

function loadPreset() {
  const saved = localStorage.getItem(presetKey)
  if (!saved) return
  try {
    remember()
    apply(parseSettings(JSON.parse(saved)))
    showNotice('已载入浏览器预设')
  } catch (cause) {
    showNotice(cause instanceof Error ? cause.message : '预设无法读取')
  }
}

function exportSettings() {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(snapshot(), null, 2)], {
      type: 'application/json',
    }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'ocean-style.json'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  showNotice('海面参数已导出')
}

async function importSettings(file: File) {
  try {
    const imported = parseSettings(JSON.parse(await file.text()))
    remember()
    apply(imported)
    showNotice(`已导入 ${file.name}`)
  } catch (cause) {
    showNotice(cause instanceof Error ? cause.message : '导入失败')
  }
}

async function start() {
  try {
    error.value = ''
    const { createOcean } = await import('../engine/babylon/ocean/createOcean')
    if (!alive || !canvas.value) return
    runtime.value = await createOcean(canvas.value, values)
    ready.value = true
  } catch (cause) {
    console.error(cause)
    error.value =
      cause instanceof Error ? cause.message : '无法初始化风格化海面渲染器。'
  }
}

onMounted(() => {
  hasSavedPreset.value = localStorage.getItem(presetKey) !== null
  void start()
})

onBeforeUnmount(() => {
  alive = false
  if (noticeTimer) clearTimeout(noticeTimer)
  runtime.value?.dispose()
})
</script>

<template>
  <main class="ocean-view">
    <canvas
      ref="canvas"
      aria-label="Interactive ocean demo"
      :data-ready="ready"
    />
    <div v-if="!ready && !error" class="loader"><i /><b /></div>

    <OceanControlPanel
      :values="values"
      :defaults="defaultOceanSettings"
      :can-undo="canUndo"
      :has-saved-preset="hasSavedPreset"
      @update="updateSetting"
      @reset-control="resetControl"
      @reset-group="resetGroup"
      @reset-all="resetAll"
      @undo="undo"
      @save-preset="savePreset"
      @load-preset="loadPreset"
      @export-settings="exportSettings"
      @import-settings="importSettings"
      @reset-camera="runtime?.resetCamera()"
    />

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error">
      {{ error }} <button @click="start">Retry</button>
    </p>
  </main>
</template>
