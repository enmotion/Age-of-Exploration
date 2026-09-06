<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onErrorCaptured,
  onMounted,
  ref,
  watch,
} from 'vue'
import WorldMapScene from '../scenes/world/WorldMapScene.vue'
import { useGameStore } from '../stores/game'
import { createFixedStepper } from '../engine/loop/fixedStep'
import { sailingAction } from '../game/sailing/controls'
import { clamp, distanceNm } from '../game/sailing/sailing'
import { ports, getPort } from '../data/ports'

const CityScene = defineAsyncComponent(() => import('../scenes/city/CityScene.vue'))
const SailingScene = defineAsyncComponent(() => import('../scenes/world/SailingScene.vue'))
const game = useGameStore()
const sail = ref(1)
const worldView = ref<'sailing' | 'chart'>('sailing')
const chartVisited = ref(false)
const tab = ref<'voyage' | 'log'>('voyage')
const cityError = ref(false)
const help = ref<HTMLDialogElement>()
const helm = ref<HTMLElement>()
const pointerRudder = ref(0)
const pressed = new Set<string>()
const destinationId = ref('funchal')
const destination = computed(() => getPort(destinationId.value)!)
const distance = computed(() =>
  distanceNm([game.telemetry.longitude, game.telemetry.latitude], destination.value.coordinates),
)
const bearing = computed(() => {
  const rad = Math.PI / 180
  const lat = game.telemetry.latitude * rad
  const targetLat = destination.value.coordinates[1] * rad
  const lon = (destination.value.coordinates[0] - game.telemetry.longitude) * rad
  return (
    (Math.atan2(
      Math.sin(lon) * Math.cos(targetLat),
      Math.cos(lat) * Math.sin(targetLat) - Math.sin(lat) * Math.cos(targetLat) * Math.cos(lon),
    ) /
      rad +
      360) %
    360
  )
})
let frame = 0
let previous = 0
let autosave: ReturnType<typeof setInterval> | undefined
let alive = true
let resumeAfterHelp = false
const stepper = createFixedStepper((dt) =>
  game.tick(dt, {
    rudder:
      pointerRudder.value ||
      Number(pressed.has('d') || pressed.has('arrowright')) -
        Number(pressed.has('a') || pressed.has('arrowleft')),
    sail: sail.value,
  }),
)
const coordinates = computed(
  () =>
    `${Math.abs(game.telemetry.latitude).toFixed(2)}° ${game.telemetry.latitude >= 0 ? 'N' : 'S'} · ${Math.abs(game.telemetry.longitude).toFixed(2)}° ${game.telemetry.longitude >= 0 ? 'E' : 'W'}`,
)

function animate(now: number) {
  if (!document.hidden) stepper.advance(previous ? (now - previous) / 1000 : 0)
  previous = now
  frame = requestAnimationFrame(animate)
}
function keydown(event: KeyboardEvent) {
  if (game.scene !== 'world' || game.portId) return
  const target = event.target instanceof HTMLElement ? event.target : undefined
  const control = target?.closest('input, select, textarea')
  // Range arrows remain native; letter shortcuts still steer after dragging the sail slider.
  const rangeShortcut =
    control instanceof HTMLInputElement && control.type === 'range' && /^[wasd]$/i.test(event.key)
  const action = sailingAction(event.key, {
    editing: Boolean((control && !rangeShortcut) || target?.isContentEditable),
    button: Boolean(target?.closest('button')),
    modal: Boolean(help.value?.open),
  })
  if (!action) return
  event.preventDefault()
  if (action === 'pause') {
    if (!event.repeat) game.paused = !game.paused
  } else if (action === 'raise-sail') sail.value = clamp(sail.value + 0.1, 0, 1)
  else if (action === 'lower-sail') sail.value = clamp(sail.value - 0.1, 0, 1)
  else pressed.add(event.key.toLowerCase())
}
function keyup(event: KeyboardEvent) {
  pressed.delete(event.key.toLowerCase())
}
function clearInput() {
  pressed.clear()
  pointerRudder.value = 0
  previous = 0
  stepper.reset()
}
function visibility() {
  clearInput()
  if (document.hidden) void game.save()
}
function openHelp() {
  clearInput()
  resumeAfterHelp = !game.paused
  game.paused = true
  help.value?.showModal()
}
function closeHelp() {
  if (resumeAfterHelp) game.paused = false
  helm.value?.focus({ preventScroll: true })
}
function showWorld(view: 'sailing' | 'chart') {
  worldView.value = view
  if (view === 'chart') chartVisited.value = true
  tab.value = 'voyage'
  game.showChart()
}
function depart() {
  sail.value = 1
  worldView.value = 'sailing'
  game.depart()
  helm.value?.focus({ preventScroll: true })
}
function steer(event: PointerEvent, direction: number) {
  if (game.portId || game.paused) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  pointerRudder.value = direction
}
function releaseSteering() {
  pointerRudder.value = 0
}
watch(() => game.scene, clearInput)
watch(() => game.paused, clearInput)
onErrorCaptured((_error, instance) => {
  if (instance?.$options.__name === 'CityScene') {
    cityError.value = true
    return false
  }
})
onMounted(async () => {
  await game.initialize()
  if (!alive) return
  sail.value = game.portId ? 1 : game.telemetry.sail
  frame = requestAnimationFrame(animate)
  autosave = setInterval(() => {
    void game.save()
  }, 15000)
  window.addEventListener('keydown', keydown)
  window.addEventListener('keyup', keyup)
  window.addEventListener('blur', clearInput)
  document.addEventListener('visibilitychange', visibility)
})
onBeforeUnmount(() => {
  alive = false
  cancelAnimationFrame(frame)
  clearInterval(autosave)
  window.removeEventListener('keydown', keydown)
  window.removeEventListener('keyup', keyup)
  window.removeEventListener('blur', clearInput)
  document.removeEventListener('visibilitychange', visibility)
})
</script>

<template>
  <div class="game-shell">
    <header class="topbar">
      <a class="brand" href="#" @click.prevent="showWorld('sailing')"
        ><span class="brand-mark">✧</span><span>航海纪元<small>AGE OF EXPLORATION</small></span></a
      >
      <nav class="top-navigation" aria-label="游戏导航">
        <button
          :class="{ active: game.scene === 'world' && worldView === 'sailing' }"
          @click="showWorld('sailing')"
        >
          航行
        </button>
        <button
          :class="{ active: game.scene === 'world' && worldView === 'chart' }"
          @click="showWorld('chart')"
        >
          海图
        </button>
        <button
          :class="{ active: game.scene === 'city' }"
          :disabled="!game.currentPort"
          @click="game.enterCity"
        >
          港口
        </button>
      </nav>
      <div class="header-stats">
        <span class="game-date">{{ game.date }}</span
        ><span class="gold">◈ {{ game.gold.toLocaleString() }}</span
        ><button class="icon-button" aria-label="打开操作指南" @click="openHelp">?</button>
      </div>
    </header>
    <main v-if="game.ready" class="play-layout">
      <div
        class="play-stage"
        :class="{ 'chart-view': game.scene === 'world' && worldView === 'chart' }"
      >
        <SailingScene
          v-show="game.scene === 'world' && worldView === 'sailing'"
          :active="game.scene === 'world' && worldView === 'sailing'"
          @chart="showWorld('chart')"
        />
        <WorldMapScene
          v-if="chartVisited"
          v-show="game.scene === 'world' && worldView === 'chart'"
          :active="game.scene === 'world' && worldView === 'chart'"
        />
        <template v-if="game.scene === 'city' && game.currentPort">
          <div v-if="cityError" class="scene-error">
            <h2>城市场景暂时无法显示</h2>
            <button @click="showWorld('sailing')">返回航行</button>
          </div>
          <Suspense v-else
            ><CityScene
              :key="game.currentPort.id"
              :port="game.currentPort"
              @error="cityError = true"
            /><template #fallback
              ><div class="loading-screen">正在进入港口…</div></template
            ></Suspense
          >
        </template>
        <div v-if="game.scene === 'world'" class="view-switch" aria-label="航行视角">
          <button :aria-pressed="worldView === 'sailing'" @click="showWorld('sailing')">
            ◈ 3D 航行</button
          ><button :aria-pressed="worldView === 'chart'" @click="showWorld('chart')">
            ⌖ 世界海图
          </button>
        </div>
        <div v-if="game.paused && game.scene === 'world'" class="pause-notice">
          <span>Ⅱ 航行已暂停</span><button @click="game.paused = false">继续航行 →</button>
        </div>
        <div ref="helm" class="helm-dock" tabindex="-1" aria-label="船舵控制台">
          <template v-if="game.portId">
            <div class="departure-copy">
              <span class="eyebrow">READY TO SET SAIL</span
              ><strong>{{ game.currentPort?.name }} · 曙光号</strong>
              <p>满帆出发，开始你的第一段航程。</p>
            </div>
            <button class="sail-away" @click="depart">扬帆出航 <span>↗</span></button>
          </template>
          <template v-else>
            <div class="live-speed">
              <span class="eyebrow">航速 / KNOTS</span
              ><strong>{{ game.telemetry.speed.toFixed(1) }}<small> 节</small></strong>
            </div>
            <div class="rudder-controls" aria-label="转舵控制">
              <button
                aria-label="按住左转"
                :disabled="game.paused"
                :class="{ held: pointerRudder === -1 }"
                @pointerdown="steer($event, -1)"
                @pointerup="releaseSteering"
                @pointercancel="releaseSteering"
                @lostpointercapture="releaseSteering"
              >
                ↶<kbd>A</kbd>
              </button>
              <button
                aria-label="按住右转"
                :disabled="game.paused"
                :class="{ held: pointerRudder === 1 }"
                @pointerdown="steer($event, 1)"
                @pointerup="releaseSteering"
                @pointercancel="releaseSteering"
                @lostpointercapture="releaseSteering"
              >
                ↷<kbd>D</kbd>
              </button>
            </div>
            <div class="sail-control">
              <label for="sail"
                >帆力 <span>{{ Math.round(sail * 100) }}%</span></label
              ><input
                id="sail"
                v-model.number="sail"
                type="range"
                min="0"
                max="1"
                step="0.05"
              /><small>W 升帆 · S 收帆</small>
            </div>
            <button
              class="helm-pause"
              :aria-label="game.paused ? '继续航行' : '暂停航行'"
              @click="game.paused = !game.paused"
            >
              {{ game.paused ? '▶' : 'Ⅱ' }}<small>空格</small>
            </button>
          </template>
        </div>
        <span v-if="game.scene === 'world'" class="sea-coordinate">{{ coordinates }}</span>
      </div>
      <aside class="voyage-sidebar">
        <section class="vessel-profile">
          <span class="eyebrow">YOUR CARAVEL</span>
          <h1>曙光号<span>01</span></h1>
          <p>逐风而行，向海而生。</p>
          <div class="vessel-state">
            <span class="status-dot" />{{
              game.portId ? '港内待命' : game.paused ? '暂停航行' : '正在航行'
            }}<span>东北风 ↙ 14 节</span>
          </div>
        </section>
        <section class="route-card">
          <label class="eyebrow" for="destination">目的港 / DESTINATION</label
          ><select id="destination" v-model="destinationId">
            <option v-for="port in ports" :key="port.id" :value="port.id">{{ port.name }}</option>
          </select>
          <p>{{ destination.region }}</p>
          <div class="route-metrics">
            <div>
              <span>剩余距离</span><strong>{{ distance.toFixed(0) }}<small> 海里</small></strong>
            </div>
            <div>
              <span>建议航向</span
              ><strong
                >{{ Math.round(bearing).toString().padStart(3, '0') }}<small>°</small></strong
              >
            </div>
          </div>
          <p class="route-hint">使用 A / D 转向建议航向，保持满帆。</p>
          <button
            class="button-secondary"
            @click="showWorld(worldView === 'chart' ? 'sailing' : 'chart')"
          >
            {{ worldView === 'chart' ? '返回 3D 航行' : '在海图上查看' }} <span>↗</span>
          </button>
        </section>
        <section class="pace-card">
          <div>
            <span class="eyebrow">航程推进</span
            ><span>{{ game.travelPace === 1 ? '标准' : '快速' }}</span>
          </div>
          <div class="pace-options">
            <button :aria-pressed="game.travelPace === 1" @click="game.travelPace = 1">
              1× 航行</button
            ><button :aria-pressed="game.travelPace === 4" @click="game.travelPace = 4">
              4× 快进
            </button>
          </div>
          <p>1 秒 = {{ game.travelPace }} 游戏小时</p>
        </section>
        <section class="port-actions">
          <span class="eyebrow">{{ game.currentPort ? '当前港口' : '附近港口' }}</span>
          <div>
            <strong>{{ game.currentPort?.name ?? game.nearestPort.port.name }}</strong
            ><small v-if="!game.currentPort">{{ game.nearestPort.distance.toFixed(1) }} 海里</small>
          </div>
          <button v-if="game.currentPort" class="button-secondary" @click="game.enterCity">
            ⚓ 进入港口 <span>→</span></button
          ><button v-else class="button-primary" :disabled="!game.canDock" @click="game.dock">
            {{ game.canDock ? '⚓ 靠岸并进入港口' : '接近至 6.5 海里可靠岸' }}
          </button>
        </section>
        <section class="captain-notes">
          <button @click="tab = tab === 'log' ? 'voyage' : 'log'">
            航海日志 <span>{{ tab === 'log' ? '−' : '+' }}</span>
          </button>
          <ol v-if="tab === 'log'">
            <li v-for="(entry, index) in game.log" :key="index">{{ entry }}</li>
          </ol>
          <p v-else>{{ game.notice }}</p>
        </section>
        <div class="save-panel">
          <span role="status">{{ game.saveStatus }}</span
          ><button @click="game.save">保存航程 ↗</button>
        </div>
      </aside>
    </main>
    <div v-else class="loading-screen" role="status">正在准备曙光号…</div>
    <footer class="statusbar">
      <span>AGE OF EXPLORATION <span class="footer-divider">/</span> 航海体验版</span
      ><span>本机自动存档 · 15 秒</span><span>海岸碰撞与贸易尚未开放</span>
    </footer>
    <dialog ref="help" class="help-dialog" @close="closeHelp">
      <span class="eyebrow">CAPTAIN’S HANDBOOK</span>
      <h2>掌舵，迎风出发。</h2>
      <p>点击画面下方「扬帆出航」，曙光号将满帆离港。</p>
      <ul>
        <li>A / D 或 ← / → 转舵，也可按住画面内的转舵按钮。</li>
        <li>W / S 升帆与收帆，空格暂停；帆力也可用滑块控制。</li>
        <li>选择目的港，按建议航向行驶。右侧 4× 快进加速航程。</li>
        <li>进入港口 6.5 海里范围后，可点击靠岸。</li>
      </ul>
      <p>3D 航行无需地图 Token。海图可以切换查看，航海进度始终共用。</p>
      <form method="dialog"><button class="button-primary">开始航行</button></form>
    </dialog>
  </div>
</template>
