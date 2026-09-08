<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useGameStore } from '../../stores/game'
import { createSailingView } from '../../engine/three/sailingView'
import { formatSkyTime } from '../../engine/three/environment/dayCycle'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ chart: [] }>()
const game = useGameStore()
const host = ref<HTMLDivElement>()
const failed = ref(false)
const assetState = ref<'loading' | 'ready' | 'fallback'>('loading')
const skySpeed = ref(1)
const skyHour = ref(15)
let view: ReturnType<typeof createSailingView> | undefined
function previewLight(hour: number) {
  skySpeed.value = 0
  view?.setSkyHour(hour)
}
function contextLost(event: Event) {
  event.preventDefault()
  failed.value = true
  view?.setActive(false)
}
onMounted(() => {
  try {
    view = createSailingView(
      host.value!,
      () => ({
        vessel: game.telemetry,
        paused: game.paused,
        docked: Boolean(game.portId),
        skySpeed: skySpeed.value,
      }),
      (state) => {
        assetState.value = state
      },
      (hour) => {
        skyHour.value = hour
      },
    )
    view.setActive(props.active)
    host.value?.querySelector('canvas')?.addEventListener('webglcontextlost', contextLost)
  } catch {
    failed.value = true
  }
})
watch(
  () => props.active,
  (active) => {
    if (!failed.value) view?.setActive(active)
  },
  { flush: 'post' },
)
onBeforeUnmount(() => {
  host.value?.querySelector('canvas')?.removeEventListener('webglcontextlost', contextLost)
  view?.dispose()
})
</script>

<template>
  <section class="sailing-scene" aria-label="三维航行视图">
    <div ref="host" class="sailing-canvas" />
    <div class="sailing-vignette" />
    <div v-if="failed" class="scene-error">
      <h2>浏览器未能创建 3D 画面</h2>
      <p>启用浏览器硬件加速后刷新，或切换海图继续航行。</p>
      <button class="button-primary" @click="emit('chart')">切换海图</button>
    </div>
    <div v-else class="voyage-title">
      <span class="eyebrow">THE ATLANTIC · 1492</span>
      <h2>{{ game.currentPort ? `${game.currentPort.name}，启程之地。` : '风起，正好远航。' }}</h2>
      <p>{{ game.currentPort ? '曙光号已就绪，海洋在等待。' : '扬起船帆，驶向地平线。' }}</p>
    </div>
    <div v-if="!failed" class="heading-readout">
      <span>船首航向</span
      ><strong>{{ Math.round(game.telemetry.heading).toString().padStart(3, '0') }}°</strong
      ><small>N · E · S · W</small>
    </div>
    <div v-if="!failed" class="camera-hint">拖动旋转视角 · 滚轮缩放 · 双击复位</div>
    <div v-if="!failed" class="sky-controls" aria-label="昼夜效果控制">
      <div class="sky-clock">
        <span>{{ skyHour >= 6 && skyHour < 18 ? '☀' : '☾' }}</span
        ><time>{{ formatSkyTime(skyHour) }}</time
        ><small>海岛光景</small>
      </div>
      <div class="sky-speed" role="group" aria-label="昼夜变化速度">
        <span>昼夜</span>
        <button
          v-for="speed in [1, 4, 12]"
          :key="speed"
          :aria-pressed="skySpeed === speed"
          :class="{ selected: skySpeed === speed }"
          @click="skySpeed = speed"
        >
          {{ speed }}×
        </button>
        <button
          :aria-pressed="skySpeed === 0"
          :class="{ selected: skySpeed === 0 }"
          @click="skySpeed = skySpeed === 0 ? 1 : 0"
        >
          定格
        </button>
      </div>
      <div class="sky-speed" role="group" aria-label="光照预览">
        <span>光景</span>
        <button @click="previewLight(12)">晴日</button>
        <button @click="previewLight(17.65)">黄昏</button>
        <button @click="previewLight(22)">月夜</button>
      </div>
      <small class="sky-caption"
        >{{ skySpeed ? `${120 / skySpeed} 秒一昼夜` : '光照已定格' }} · 独立于航程时间</small
      >
    </div>
    <div v-if="!failed && assetState === 'loading'" class="asset-status">正在装配船只…</div>
    <div v-if="!failed && assetState === 'fallback'" class="asset-status">
      素材加载失败，已切换备用船体
    </div>
  </section>
</template>
