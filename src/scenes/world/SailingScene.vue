<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useGameStore } from '../../stores/game'
import { createSailingView } from '../../engine/three/sailingView'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ chart: [] }>()
const game = useGameStore()
const host = ref<HTMLDivElement>()
const failed = ref(false)
let view: ReturnType<typeof createSailingView> | undefined
function contextLost(event: Event) {
  event.preventDefault()
  failed.value = true
  view?.setActive(false)
}
onMounted(() => {
  try {
    view = createSailingView(host.value!, () => ({
      vessel: game.telemetry,
      paused: game.paused,
      docked: Boolean(game.portId),
    }))
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
  </section>
</template>
