<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useGameStore } from '../../stores/game'
import { createSailingView, type GraphicsSettings } from '../../engine/three/sailingView'
import { formatSkyTime } from '../../engine/three/environment/dayCycle'
import { windEfficiency } from '../../game/sailing/sailing'
import { MAX_WAVE_HEIGHT, waveScaleForWind } from '../../engine/three/environment/waves'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ chart: [] }>()
const game = useGameStore()
const host = ref<HTMLDivElement>()
const failed = ref(false)
const assetState = ref<'loading' | 'ready' | 'fallback'>('loading')
const skySpeed = ref(1)
const skyHour = ref(15)
const settingsOpen = ref(false)
const measuredFps = ref(0)
const settingsTab = ref<'graphics' | 'weather' | 'display'>('graphics')
const storageKey = 'age-of-exploration.settings.v1'
const weatherStorageKey = 'age-of-exploration.weather.v1'
const settings = reactive<
  GraphicsSettings & {
    headingVisible: boolean
    skyControlsVisible: boolean
    cameraHintVisible: boolean
    performanceVisible: boolean
  }
>({
  renderScale: 1,
  fpsLimit: 60,
  shadows: 'high',
  reflection: 'high',
  waveDetail: 'high',
  foam: true,
  wakeStrength: 1,
  wakeTurbulence: 1.25,
  bowFoamStrength: 1.2,
  bowFoamWidth: 1.6,
  foamLifetime: 6,
  vegetationAnimation: true,
  stormEffects: true,
  headingVisible: true,
  skyControlsVisible: true,
  cameraHintVisible: true,
  performanceVisible: false,
})
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(storageKey) ?? '{}'))
  Object.assign(game.conditions, JSON.parse(localStorage.getItem(weatherStorageKey) ?? '{}'))
} catch {
  // Ignore damaged local preferences and retain safe defaults.
}
const followingSpeed = computed(() =>
  (
    Math.min(10, game.conditions.windSpeed * 0.65) *
    (1 - game.conditions.load * 0.35) *
    game.conditions.hull *
    game.conditions.crew
  ).toFixed(1),
)
const currentEfficiency = computed(() =>
  windEfficiency(game.telemetry.heading, game.conditions.windHeading),
)
const currentWindSpeed = computed(() =>
  (Number(followingSpeed.value) * currentEfficiency.value * game.telemetry.sail).toFixed(1),
)
const estimatedWaveHeight = computed(() =>
  (MAX_WAVE_HEIGHT * waveScaleForWind(game.conditions.windSpeed)).toFixed(1),
)
const cappedDpr = Math.min(window.devicePixelRatio, 1.5).toFixed(1)
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
        windSpeed: game.conditions.windSpeed,
        windHeading: game.conditions.windHeading,
        graphics: settings,
      }),
      (state) => {
        assetState.value = state
      },
      (hour) => {
        skyHour.value = hour
      },
      (fps) => {
        measuredFps.value = fps
      },
    )
    view.setGraphics(settings)
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
watch(
  settings,
  () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings))
    } catch {
      // Rendering controls still work when browser storage is unavailable.
    }
    view?.setGraphics(settings)
  },
  { deep: true },
)
watch(
  game.conditions,
  () => {
    try {
      localStorage.setItem(weatherStorageKey, JSON.stringify(game.conditions))
    } catch {
      // Weather controls still work when browser storage is unavailable.
    }
  },
  { deep: true },
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
    <div v-if="!failed && settings.headingVisible" class="heading-readout">
      <span>船首航向</span
      ><strong>{{ Math.round(game.telemetry.heading).toString().padStart(3, '0') }}°</strong
      ><small>N · E · S · W</small>
    </div>
    <div v-if="!failed && settings.cameraHintVisible" class="camera-hint">
      拖动旋转视角 · 滚轮缩放 · 双击复位
    </div>
    <div
      v-if="!failed && settings.skyControlsVisible"
      class="sky-controls"
      aria-label="昼夜效果控制"
    >
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
    <button
      v-if="!failed && !settingsOpen"
      class="settings-trigger"
      aria-label="打开航海设置"
      @click="settingsOpen = true"
    >
      ⚙ 设置
    </button>
    <aside
      v-if="!failed"
      class="settings-drawer"
      :class="{ open: settingsOpen }"
      aria-label="航海设置"
    >
      <header>
        <div>
          <span class="eyebrow">VOYAGE OPTIONS</span>
          <h2>航海设置</h2>
        </div>
        <button aria-label="收起设置" @click="settingsOpen = false">×</button>
      </header>
      <nav class="settings-tabs" aria-label="设置分类">
        <button
          v-for="item in [
            ['graphics', '画质'],
            ['weather', '风浪'],
            ['display', '显示'],
          ] as const"
          :key="item[0]"
          :aria-pressed="settingsTab === item[0]"
          @click="settingsTab = item[0]"
        >
          {{ item[1] }}
        </button>
      </nav>
      <section v-if="settingsTab === 'graphics'" class="settings-content">
        <p class="settings-note">只改变视觉成本，不影响航行结果。</p>
        <label
          >渲染比例 <output>{{ Math.round(settings.renderScale * 100) }}%</output
          ><input v-model.number="settings.renderScale" type="range" min="0.5" max="1" step="0.05"
        /></label>
        <label
          >帧率上限<select v-model.number="settings.fpsLimit">
            <option :value="30">30 FPS</option>
            <option :value="45">45 FPS</option>
            <option :value="60">60 FPS</option>
          </select></label
        >
        <label
          >阴影质量<select v-model="settings.shadows">
            <option value="off">关闭</option>
            <option value="low">低 · 512</option>
            <option value="medium">中 · 1024</option>
            <option value="high">高 · 2048</option>
          </select></label
        >
        <label
          >水面反射<select v-model="settings.reflection">
            <option value="off">关闭</option>
            <option value="low">低</option>
            <option value="high">高</option>
          </select></label
        >
        <label
          >海浪细节<select v-model="settings.waveDetail">
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select></label
        >
        <label class="settings-switch"
          ><input v-model="settings.foam" type="checkbox" /> 白沫与完整尾迹</label
        >
        <label
          >船尾浪花强度 <output>{{ Math.round(settings.wakeStrength * 100) }}%</output
          ><input v-model.number="settings.wakeStrength" type="range" min="0" max="4" step="0.05"
        /></label>
        <label
          >船尾躁动程度 <output>{{ Math.round(settings.wakeTurbulence * 100) }}%</output
          ><input v-model.number="settings.wakeTurbulence" type="range" min="0" max="8" step="0.1"
        /></label>
        <label
          >船首泡沫强度 <output>{{ Math.round(settings.bowFoamStrength * 100) }}%</output
          ><input
            v-model.number="settings.bowFoamStrength"
            type="range"
            min="0"
            max="4"
            step="0.05"
        /></label>
        <label
          >船首泡沫宽度 <output>{{ Math.round(settings.bowFoamWidth * 100) }}%</output
          ><input
            v-model.number="settings.bowFoamWidth"
            type="range"
            min="0.5"
            max="2.5"
            step="0.05"
        /></label>
        <label
          >泡沫持续时间 <output>{{ settings.foamLifetime.toFixed(1) }} 秒</output
          ><input v-model.number="settings.foamLifetime" type="range" min="1" max="12" step="0.5"
        /></label>
        <label class="settings-switch"
          ><input v-model="settings.vegetationAnimation" type="checkbox" /> 岛屿植被动画</label
        >
        <label class="settings-switch"
          ><input v-model="settings.stormEffects" type="checkbox" /> 暴雨与风暴氛围</label
        >
      </section>
      <section v-else-if="settingsTab === 'weather'" class="settings-content">
        <p class="settings-note">调试天气会真实改变浪高和帆船航速。</p>
        <label
          >风速 <output>{{ game.conditions.windSpeed }} kn</output
          ><input
            v-model.number="game.conditions.windSpeed"
            type="range"
            min="0"
            max="120"
            step="1"
        /></label>
        <label
          >风向 <output>{{ game.conditions.windHeading }}°</output
          ><input
            v-model.number="game.conditions.windHeading"
            type="range"
            min="0"
            max="359"
            step="1"
        /></label>
        <div class="weather-readout">
          <span
            >当前航向预计<strong>{{ currentWindSpeed }} kn</strong></span
          ><span
            >完全顺风预计<strong>{{ followingSpeed }} kn</strong></span
          ><span
            >最大波幅约<strong>{{ estimatedWaveHeight }} m</strong></span
          >
        </div>
      </section>
      <section v-else class="settings-content">
        <p class="settings-note">控制界面信息，不改变渲染和模拟。</p>
        <label class="settings-switch"
          ><input v-model="settings.headingVisible" type="checkbox" /> 船首航向</label
        >
        <label class="settings-switch"
          ><input v-model="settings.skyControlsVisible" type="checkbox" /> 昼夜控制</label
        >
        <label class="settings-switch"
          ><input v-model="settings.cameraHintVisible" type="checkbox" /> 镜头操作提示</label
        >
        <label class="settings-switch"
          ><input v-model="settings.performanceVisible" type="checkbox" /> 性能监视器</label
        >
        <div v-if="settings.performanceVisible" class="performance-readout">
          实时 {{ measuredFps.toFixed(0) }} FPS · 渲染 {{ Math.round(settings.renderScale * 100) }}%
          · 上限 {{ settings.fpsLimit }} · DPR {{ cappedDpr }}
        </div>
      </section>
      <footer>设置会自动保存在此浏览器</footer>
    </aside>
  </section>
</template>
