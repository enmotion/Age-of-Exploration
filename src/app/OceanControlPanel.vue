<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { OceanSettings } from '../domain/ocean'
import OceanControlRow from './OceanControlRow.vue'
import {
  oceanControlGroups,
  type OceanControl,
  type OceanControlGroup,
} from './oceanControls'

defineProps<{
  values: OceanSettings
  defaults: Readonly<OceanSettings>
  canUndo: boolean
  hasSavedPreset: boolean
}>()

const emit = defineEmits<{
  update: [key: keyof OceanSettings, value: string | number | boolean]
  resetControl: [key: keyof OceanSettings]
  resetGroup: [keys: Array<keyof OceanSettings>]
  resetAll: []
  undo: []
  savePreset: []
  loadPreset: []
  exportSettings: []
  importSettings: [file: File]
  resetCamera: []
}>()

const panelOpen = ref(true)
const fileInput = ref<HTMLInputElement>()
const open = reactive<Record<string, boolean>>(
  Object.fromEntries(
    oceanControlGroups.flatMap((group) => [
      [group.id, group.id === 'style'],
      ...(group.children?.map((child) => [child.id, false] as const) ?? []),
    ]),
  ),
)

const lightingPresets = [
  {
    label: '清晨',
    inclination: 0.2,
    azimuth: 0.28,
    luminance: 1.15,
    light: 1.0,
  },
  {
    label: '正午',
    inclination: 0.9,
    azimuth: -0.12,
    luminance: 1.3,
    light: 1.5,
  },
  {
    label: '黄昏',
    inclination: 0.1,
    azimuth: -0.26,
    luminance: 1.05,
    light: 1.0,
  },
  {
    label: '夜晚',
    inclination: -0.14,
    azimuth: 0.2,
    luminance: 0.62,
    light: 0.45,
  },
] as const

function groupKeys(group: OceanControlGroup) {
  return [
    ...group.controls,
    ...(group.children?.flatMap((child) => child.controls) ?? []),
  ].map((control) => control.key)
}

function chooseImport() {
  fileInput.value?.click()
}

function importFile(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('importSettings', file)
  input.value = ''
}

function update(key: OceanControl['key'], value: string | number | boolean) {
  emit('update', key, value)
}

function applyLightingPreset(preset: (typeof lightingPresets)[number]) {
  emit('update', 'inclination', preset.inclination)
  emit('update', 'azimuth', preset.azimuth)
  emit('update', 'luminance', preset.luminance)
  emit('update', 'lightIntensity', preset.light)
}
</script>

<template>
  <aside
    class="control-panel"
    :class="{ collapsed: !panelOpen }"
    aria-label="海面调节面板"
  >
    <header class="panel-header">
      <button
        class="panel-toggle"
        type="button"
        :aria-expanded="panelOpen"
        aria-controls="ocean-panel-body"
        @click="panelOpen = !panelOpen"
      >
        <span class="panel-mark" aria-hidden="true">≈</span>
        <span class="panel-heading">
          <strong>海面实验室</strong>
          <small>ART-DIRECTED OCEAN</small>
        </span>
        <span class="panel-chevron" aria-hidden="true">{{
          panelOpen ? '›' : '‹'
        }}</span>
      </button>
    </header>

    <div v-show="panelOpen" id="ocean-panel-body" class="panel-body">
      <div class="quick-status">
        <button
          type="button"
          :class="{ active: values.stylized }"
          :aria-pressed="values.stylized"
          @click="emit('update', 'stylized', !values.stylized)"
        >
          {{ values.stylized ? '风格化' : '柔和明暗' }}
        </button>
        <button
          type="button"
          :class="{ active: values.animationPaused }"
          :aria-pressed="values.animationPaused"
          @click="emit('update', 'animationPaused', !values.animationPaused)"
        >
          {{ values.animationPaused ? '继续' : '暂停' }}
        </button>
        <button type="button" @click="emit('resetCamera')">镜头复位</button>
      </div>

      <div class="lighting-presets" aria-label="昼夜光照预设">
        <button
          v-for="preset in lightingPresets"
          :key="preset.label"
          type="button"
          :class="{
            active: Math.abs(values.inclination - preset.inclination) < 0.01,
          }"
          @click="applyLightingPreset(preset)"
        >
          {{ preset.label }}
        </button>
      </div>

      <nav class="panel-actions" aria-label="参数操作">
        <button type="button" :disabled="!canUndo" @click="emit('undo')">
          撤销
        </button>
        <button type="button" @click="emit('resetAll')">全部重置</button>
        <button type="button" @click="emit('savePreset')">保存</button>
        <button
          type="button"
          :disabled="!hasSavedPreset"
          @click="emit('loadPreset')"
        >
          载入
        </button>
        <button type="button" @click="emit('exportSettings')">导出</button>
        <button type="button" @click="chooseImport">导入</button>
        <input
          ref="fileInput"
          class="visually-hidden"
          type="file"
          accept="application/json,.json"
          @change="importFile"
        />
      </nav>

      <p class="range-policy">
        <span aria-hidden="true">↔</span>
        未标注边界的数值均可在任意有限实数范围内输入。
      </p>

      <section
        v-for="group in oceanControlGroups"
        :key="group.id"
        class="control-section"
      >
        <div class="section-bar">
          <button
            class="section-toggle"
            type="button"
            :aria-label="group.title"
            :aria-expanded="open[group.id]"
            @click="open[group.id] = !open[group.id]"
          >
            <span aria-hidden="true">{{ open[group.id] ? '−' : '+' }}</span>
            <span>
              <strong>{{ group.title }}</strong>
              <small>{{ group.description }}</small>
            </span>
            <em v-if="group.badge">{{ group.badge }}</em>
          </button>
          <button
            class="reset-section"
            type="button"
            :aria-label="`重置${group.title}`"
            title="重置此区域"
            @click="emit('resetGroup', groupKeys(group))"
          >
            ↺
          </button>
        </div>

        <div v-show="open[group.id]" class="section-content">
          <OceanControlRow
            v-for="control in group.controls"
            :key="control.key"
            :control="control"
            :value="values[control.key]"
            :default-value="defaults[control.key]"
            :context="group.title"
            @update="update"
            @reset="emit('resetControl', $event)"
          />

          <section
            v-for="child in group.children"
            :key="child.id"
            class="control-subsection"
          >
            <div class="subsection-bar">
              <button
                class="subsection-toggle"
                type="button"
                :aria-label="child.title"
                :aria-expanded="open[child.id]"
                @click="open[child.id] = !open[child.id]"
              >
                <span aria-hidden="true">{{ open[child.id] ? '−' : '+' }}</span>
                <strong>{{ child.title }}</strong>
                <em v-if="child.badge">{{ child.badge }}</em>
              </button>
              <button
                class="reset-section"
                type="button"
                :aria-label="`重置${child.title}`"
                title="重置此子区域"
                @click="
                  emit(
                    'resetGroup',
                    child.controls.map((control) => control.key),
                  )
                "
              >
                ↺
              </button>
            </div>
            <div v-show="open[child.id]" class="subsection-content">
              <OceanControlRow
                v-for="control in child.controls"
                :key="control.key"
                :control="control"
                :value="values[control.key]"
                :default-value="defaults[control.key]"
                :context="`${group.title} · ${child.title}`"
                @update="update"
                @reset="emit('resetControl', $event)"
              />
            </div>
          </section>
        </div>
      </section>
    </div>
  </aside>
</template>
