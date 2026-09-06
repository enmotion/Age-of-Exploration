<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ports } from '../../data/ports'
import { useGameStore } from '../../stores/game'
import type { Map as MapboxMap, Marker } from 'mapbox-gl'

const props = defineProps<{ active: boolean }>()
const game = useGameStore()
const container = ref<HTMLDivElement>()
const status = ref('示意海图 · 无需联网')
const mapReady = ref(false)
const following = ref(true)
let map: MapboxMap | undefined
let markers: Marker[] = []
let disposed = false
let timeout: ReturnType<typeof setTimeout> | undefined
const project = (longitude: number, latitude: number) => [
  ((longitude + 20) / 19) * 1000,
  ((44 - latitude) / 18) * 850,
]
const shipPosition = computed(() => project(game.telemetry.longitude, game.telemetry.latitude))

function followShip() {
  following.value = true
  map?.easeTo({ center: [game.telemetry.longitude, game.telemetry.latitude], duration: 500 })
}

onMounted(async () => {
  const token = import.meta.env.VITE_MAPBOX_TOKEN?.trim()
  const style = import.meta.env.VITE_MAPBOX_STYLE_URL?.trim()
  if (!token && !style) return
  if (!token?.startsWith('pk.') || !style?.startsWith('mapbox://styles/')) {
    status.value = '地图配置不完整 · 使用示意海图'
    return
  }
  status.value = '正在加载真实海图…'
  try {
    const [{ default: mapboxgl }, { createShipLayer }] = await Promise.all([
      import('mapbox-gl'),
      import('../../engine/mapbox/shipLayer'),
      import('mapbox-gl/dist/mapbox-gl.css'),
    ])
    if (disposed || !container.value) return
    map = new mapboxgl.Map({
      container: container.value,
      accessToken: token,
      style,
      projection: 'mercator',
      center: [game.telemetry.longitude, game.telemetry.latitude],
      zoom: 6,
      pitch: 45,
      antialias: true,
      maxPitch: 65,
    })
    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right')
    map.on('dragstart', () => {
      following.value = false
    })
    timeout = setTimeout(() => {
      if (!mapReady.value) status.value = '地图加载超时 · 可继续使用示意海图'
    }, 15000)
    map.on('error', () => {
      status.value = '地图服务暂不可用 · 可继续使用示意海图'
      mapReady.value = false
    })
    map.on('load', () => {
      if (!map || disposed) return
      clearTimeout(timeout)
      map.addLayer(createShipLayer(() => game.telemetry))
      markers = ports.map((port) => {
        const element = document.createElement('div')
        element.className = 'map-port-marker'
        element.textContent = `⚓ ${port.name}`
        return new mapboxgl.Marker({ element }).setLngLat(port.coordinates).addTo(map!)
      })
      mapReady.value = true
      status.value = 'Mapbox · 实时海图'
      map.resize()
    })
  } catch {
    status.value = '地图初始化失败 · 使用示意海图'
  }
})

watch(
  () => game.telemetry,
  (vessel) => {
    if (!props.active || !mapReady.value || !map) return
    if (following.value) map.jumpTo({ center: [vessel.longitude, vessel.latitude] })
    map.triggerRepaint()
  },
)
watch(
  () => props.active,
  (active) => {
    if (active)
      requestAnimationFrame(() => {
        if (!disposed) {
          map?.resize()
          map?.triggerRepaint()
        }
      })
    else map?.stop()
  },
)
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(timeout)
  markers.forEach((marker) => marker.remove())
  markers = []
  map?.remove()
})
</script>

<template>
  <section class="world-scene" aria-label="世界航海地图">
    <svg
      v-if="!mapReady"
      class="chart"
      viewBox="0 0 1000 850"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="伊比利亚、北非与大西洋群岛的示意海图，尚未实现海岸碰撞"
    >
      <defs>
        <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
          <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#8eaba4" stroke-opacity=".15" />
        </pattern>
        <radialGradient id="sea">
          <stop stop-color="#346367" />
          <stop offset="1" stop-color="#153c43" />
        </radialGradient>
        <filter id="land-shadow">
          <feDropShadow dx="0" dy="5" stdDeviation="10" flood-opacity=".25" />
        </filter>
      </defs>
      <rect width="1000" height="850" fill="url(#sea)" />
      <rect width="1000" height="850" fill="url(#grid)" />
      <g stroke="#95aca0" stroke-opacity=".16" fill="none">
        <circle cx="350" cy="470" r="160" />
        <circle cx="350" cy="470" r="290" />
        <path d="M0 120 900 800 M0 800 980 140 M350 0V850 M0 470H1000" />
      </g>
      <g fill="#c5c3a0" stroke="#d9d4af" stroke-width="2" filter="url(#land-shadow)">
        <path
          d="M568 -30 1000 -30 1000 296 914 322 874 356 851 364 824 365 801 374 788 388 775 364 750 362 725 340 695 338 671 327 643 324 637 290 585 288 591 264 569 253 582 226 578 197 594 170 574 152 555 108 540 76Z"
        />
        <path
          d="M1000 385 920 391 853 397 831 384 807 386 788 407 771 432 740 457 710 474 681 490 656 512 636 536 617 562 602 592 573 619 555 659 520 704 478 756 448 804 430 850 1000 850Z"
        />
        <path d="M146 534 164 529 176 535 167 543 148 542Z" />
        <path
          d="M205 752 215 746 224 754 218 765 207 765Z M239 733 249 730 254 740 247 747Z M167 741 174 737 179 746 171 749Z M278 704 284 695 292 713 283 722Z"
        />
      </g>
      <g fill="none" stroke="#9e9f80" opacity=".45" stroke-width="1.2">
        <path
          d="m652 148 25-36 27 37 21-26 30 30 30-21 38 47 M755 258l29-44 20 31 32-46 35 46 M733 535l30-44 26 36 35-27 52 33 M681 634l29-40 27 42 39-25 38 32"
        />
      </g>
      <text x="751" y="205" class="land-label">I B E R I A</text>
      <text x="795" y="590" class="land-label">M A G H R E B</text>
      <text x="182" y="350" class="ocean-label">A T L A N T I C</text>
      <text x="237" y="379" class="ocean-subtitle">O C E A N</text>
      <path
        d="M568 252 Q290 345 162 536 Q143 659 242 749"
        fill="none"
        stroke="#e0c389"
        stroke-opacity=".4"
        stroke-width="1.5"
        stroke-dasharray="5 9"
      />
      <g
        v-for="port in ports"
        :key="port.id"
        :transform="`translate(${project(...port.coordinates).join(',')})`"
      >
        <circle r="10" fill="#e0c389" fill-opacity=".15" />
        <circle r="4" fill="#ead5a5" stroke="#253f3e" stroke-width="2" />
        <text x="14" :y="port.id === 'seville' ? -12 : 5" class="port-label">{{ port.name }}</text>
      </g>
      <g :transform="`translate(${shipPosition.join(',')})`">
        <circle r="27" fill="none" stroke="#f2d99b" stroke-opacity=".4" stroke-dasharray="3 5" />
        <g :transform="`rotate(${game.telemetry.heading})`">
          <path d="M0-20 8 14 0 9-8 14Z" fill="#fff0c8" stroke="#102e34" stroke-width="2" />
        </g>
      </g>
      <g transform="translate(140,650)" fill="#c7c5a2" opacity=".65">
        <circle r="45" fill="none" stroke="currentColor" />
        <path
          d="M0-61 8-8 0 0-8-8Z M61 0 8 8 0 0 8-8Z M0 61-8 8 0 0 8 8Z M-61 0-8-8 0 0-8 8Z"
          fill="currentColor"
        />
        <text y="-73" text-anchor="middle" font-size="15">N</text>
      </g>
    </svg>
    <div ref="container" class="mapbox-container" :class="{ 'map-hidden': !mapReady }" />
    <div class="chart-heading">
      <span class="eyebrow">THE KNOWN WORLD · 1492</span>
      <h2>向未知，扬帆。</h2>
      <p>伊比利亚半岛 — 北非 — 加那利群岛</p>
    </div>
    <div class="map-status"><span class="status-dot" />{{ status }}</div>
    <button v-if="mapReady" class="follow-button" @click="followShip">
      {{ following ? '◎ 镜头跟随中' : '◎ 跟随船只' }}
    </button>
    <div v-if="!mapReady" class="chart-footnote">PHASE 0 · 示意海岸线，不用于导航碰撞</div>
  </section>
</template>
