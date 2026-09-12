<script setup lang="ts">
import { computed } from 'vue'
import type { OceanControl } from './oceanControls'

const props = defineProps<{
  control: OceanControl
  value: string | number | boolean
  defaultValue: string | number | boolean
  context: string
}>()

const emit = defineEmits<{
  update: [key: OceanControl['key'], value: string | number | boolean]
  reset: [key: OceanControl['key']]
}>()

const bounded = computed(
  () => props.control.min !== undefined && props.control.max !== undefined,
)
const fullLabel = computed(() => `${props.context} · ${props.control.label}`)

function constraintText() {
  if (props.control.type === 'check') return '开 / 关'
  if (props.control.type === 'color') return 'HEX 色值'
  if (props.control.type === 'select') return '离散选项'
  const { min, max, exclusiveMin, integer } = props.control
  if (min !== undefined && max !== undefined) {
    return `${exclusiveMin ? '(' : '['}${min}, ${max}]${integer ? ' · 整数' : ''}`
  }
  if (min !== undefined) {
    return `${exclusiveMin ? '>' : '≥'} ${min}${integer ? ' · 整数' : ''}`
  }
  if (max !== undefined) return `≤ ${max}${integer ? ' · 整数' : ''}`
  return integer ? '−∞ … +∞ · 整数' : '−∞ … +∞'
}

function numberIsValid(value: number) {
  const { min, max, exclusiveMin, integer } = props.control
  if (!Number.isFinite(value)) return false
  if (min !== undefined && (exclusiveMin ? value <= min : value < min))
    return false
  if (max !== undefined && value > max) return false
  return !integer || Number.isInteger(value)
}

function updateNumber(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const value = input.valueAsNumber
  input.setCustomValidity(
    numberIsValid(value) ? '' : `有效范围：${constraintText()}`,
  )
  if (input.validity.valid && numberIsValid(value)) {
    emit('update', props.control.key, value)
  }
}

function restoreInvalidNumber(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  if (!numberIsValid(input.valueAsNumber)) input.value = String(props.value)
  input.setCustomValidity('')
}

function updateText(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const valid = /^#[0-9a-fA-F]{6}$/.test(input.value)
  input.setCustomValidity(valid ? '' : '请输入 #RRGGBB 格式的颜色')
  if (valid) emit('update', props.control.key, input.value)
}

function restoreInvalidColor(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  if (!/^#[0-9a-fA-F]{6}$/.test(input.value)) {
    input.value = String(props.value)
  }
  input.setCustomValidity('')
}
</script>

<template>
  <div
    class="control-row"
    :class="{ 'is-disabled': control.disabled }"
    :title="control.hint"
  >
    <div class="control-copy">
      <label :for="`control-${String(control.key)}`">{{ control.label }}</label>
      <small>{{ control.disabled ? '未接入' : constraintText() }}</small>
    </div>

    <div class="control-widget">
      <select
        v-if="control.type === 'select'"
        :id="`control-${String(control.key)}`"
        :aria-label="fullLabel"
        :value="value"
        :disabled="control.disabled"
        @change="
          emit(
            'update',
            control.key,
            ($event.currentTarget as HTMLSelectElement).value,
          )
        "
      >
        <option
          v-for="option in control.options"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>

      <label v-else-if="control.type === 'check'" class="switch">
        <input
          :id="`control-${String(control.key)}`"
          :aria-label="fullLabel"
          type="checkbox"
          :checked="Boolean(value)"
          :disabled="control.disabled"
          @change="
            emit(
              'update',
              control.key,
              ($event.currentTarget as HTMLInputElement).checked,
            )
          "
        />
        <span aria-hidden="true" />
      </label>

      <div v-else-if="control.type === 'color'" class="color-widget">
        <input
          :id="`control-${String(control.key)}`"
          :aria-label="fullLabel"
          type="color"
          :value="String(value)"
          :disabled="control.disabled"
          @input="updateText"
        />
        <input
          :aria-label="`${fullLabel} HEX`"
          class="color-text"
          type="text"
          :value="value"
          :disabled="control.disabled"
          pattern="#[0-9a-fA-F]{6}"
          @change="updateText"
          @blur="restoreInvalidColor"
        />
      </div>

      <div v-else class="number-widget" :class="{ bounded }">
        <input
          v-if="bounded"
          :aria-label="`${fullLabel} 滑杆`"
          type="range"
          :value="value"
          :min="control.min"
          :max="control.max"
          :step="control.step"
          :disabled="control.disabled"
          @input="updateNumber"
        />
        <input
          :id="`control-${String(control.key)}`"
          :aria-label="fullLabel"
          class="numeric"
          type="number"
          :value="value"
          :min="control.min"
          :max="control.max"
          :step="control.integer ? 1 : 'any'"
          :disabled="control.disabled"
          @input="updateNumber"
          @blur="restoreInvalidNumber"
        />
      </div>
    </div>

    <button
      class="reset-control"
      type="button"
      :aria-label="`重置${fullLabel}`"
      title="恢复默认值"
      :disabled="control.disabled || value === defaultValue"
      @click="emit('reset', control.key)"
    >
      ↺
    </button>
  </div>
</template>
