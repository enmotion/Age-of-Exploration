import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { getPort, homePort, ports } from '../data/ports'
import {
  defaultConditions,
  distanceNm,
  stepSailing,
  type SailingInput,
  type VesselState,
} from '../game/sailing/sailing'
import { IndexedDbSaveRepository, type GameSave } from '../persistence/saveRepository'

export const useGameStore = defineStore('game', () => {
  const vessel: VesselState = {
    longitude: homePort.coordinates[0],
    latitude: homePort.coordinates[1],
    heading: 210,
    speed: 0,
    sail: 0,
  }
  const telemetry = shallowRef({ ...vessel })
  const scene = ref<'world' | 'city'>('world')
  const portId = ref<string | null>(homePort.id)
  const gold = ref(2400)
  const gameHours = ref(0)
  const paused = ref(false)
  // Baseline is four times the original preview; acceleration changes game time, not knots.
  const travelPace = ref<1 | 4>(1)
  const ready = ref(false)
  const saveStatus = ref('正在读取航海记录…')
  const notice = ref('欢迎来到里斯本。进入港口参观，或解缆开始航行。')
  const log = ref(['1492 年 8 月 3 日 · 曙光号停泊于里斯本。'])
  const currentPort = computed(() => (portId.value ? getPort(portId.value) : undefined))
  const nearestPort = computed(
    () =>
      ports
        .map((port) => ({
          port,
          distance: distanceNm(
            [telemetry.value.longitude, telemetry.value.latitude],
            port.coordinates,
          ),
        }))
        .sort((a, b) => a.distance - b.distance)[0]!,
  )
  const canDock = computed(
    () => nearestPort.value.distance * 1852 <= nearestPort.value.port.dockingRadiusMeters,
  )
  const date = computed(() =>
    new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(1492, 7, 3) + gameHours.value * 3600000)),
  )
  let repository: IndexedDbSaveRepository | undefined
  let allowSave = true
  let simulatedHours = 0
  let publishElapsed = 0
  let saveQueue: Promise<void> = Promise.resolve()

  function publish() {
    telemetry.value = { ...vessel }
    gameHours.value = simulatedHours
  }
  function announce(message: string) {
    notice.value = message
    log.value = [message, ...log.value].slice(0, 12)
  }
  async function initialize() {
    try {
      repository = new IndexedDbSaveRepository()
      const saved = await repository.load()
      if (saved) {
        Object.assign(vessel, saved.vessel)
        scene.value = saved.scene
        portId.value = saved.portId
        gold.value = saved.gold
        simulatedHours = saved.gameHours
        announce('已恢复上一次航海记录。')
      }
      saveStatus.value = saved ? '进度已恢复' : '本地存档已就绪'
    } catch {
      allowSave = false
      saveStatus.value = '存档读取失败，本次进度不会覆盖原存档'
    } finally {
      publish()
      ready.value = true
    }
  }
  function save() {
    if (!ready.value || !repository || !allowSave) return Promise.resolve()
    const snapshot: GameSave = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      gameHours: simulatedHours,
      gold: gold.value,
      portId: portId.value,
      scene: scene.value,
      vessel: { ...vessel },
    }
    saveQueue = saveQueue.then(async () => {
      saveStatus.value = '正在保存…'
      try {
        await repository!.save(snapshot)
        saveStatus.value = '进度已保存至本机'
      } catch {
        saveStatus.value = '保存失败，请检查浏览器存储权限或空间'
      }
    })
    return saveQueue
  }
  function tick(dt: number, input: SailingInput) {
    if (!ready.value || paused.value || scene.value !== 'world' || portId.value) return
    const hours = dt * travelPace.value
    stepSailing(vessel, input, defaultConditions, dt, hours)
    simulatedHours += hours
    publishElapsed += dt
    if (publishElapsed >= 0.1) {
      publish()
      publishElapsed = 0
    }
  }
  function enterCity() {
    if (!currentPort.value) return
    scene.value = 'city'
    void save()
  }
  function showChart() {
    scene.value = 'world'
    void save()
  }
  function depart() {
    if (!currentPort.value) return
    announce(`已离开${currentPort.value.name}。调整帆力，使用 A / D 控制船舵。`)
    portId.value = null
    scene.value = 'world'
    vessel.sail = 1
    paused.value = false
    publish()
    void save()
  }
  function dock() {
    if (portId.value || !canDock.value) return
    const port = nearestPort.value.port
    portId.value = port.id
    vessel.longitude = port.coordinates[0]
    vessel.latitude = port.coordinates[1]
    vessel.speed = 0
    vessel.sail = 0
    publish()
    announce(`已停靠${port.name}，航海记录已更新。`)
    enterCity()
  }
  return {
    telemetry,
    scene,
    portId,
    gold,
    gameHours,
    paused,
    travelPace,
    ready,
    saveStatus,
    notice,
    log,
    currentPort,
    nearestPort,
    canDock,
    date,
    initialize,
    save,
    tick,
    enterCity,
    showChart,
    depart,
    dock,
  }
})
