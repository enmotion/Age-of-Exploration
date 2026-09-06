<script setup lang="ts">
import { computed } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { Vector3 } from 'three'
import type { PortDefinition } from '../../data/ports'
import { generateCity } from './layout'

const props = defineProps<{ port: PortDefinition }>()
const emit = defineEmits<{ error: [error: Error] }>()
const lots = computed(() => generateCity(props.port.seed))
const colors = computed(() =>
  props.port.styleKitId === 'iberian'
    ? ['#e7d8b7', '#d3bd99', '#f0e5ce']
    : ['#d7b88a', '#bd996f', '#e1c7a0'],
)
</script>

<template>
  <section class="city-scene" aria-label="港口三维占位场景">
    <TresCanvas
      clear-color="#28494c"
      :dpr="[1, 1.5]"
      render-mode="on-demand"
      @error="emit('error', $event)"
    >
      <TresPerspectiveCamera :position="new Vector3(65, 60, 80)" :look-at="[0, 0, 0]" :fov="42" />
      <TresAmbientLight :intensity="2" />
      <TresDirectionalLight :position="new Vector3(-20, 45, 20)" :intensity="3" color="#ffe6bc" />
      <TresMesh :position="new Vector3(0, -1, 0)"
        ><TresBoxGeometry :args="[76, 2, 64]" /><TresMeshStandardMaterial color="#b6aa88"
      /></TresMesh>
      <TresMesh :position="new Vector3(0, -1.3, 48)"
        ><TresBoxGeometry :args="[250, 1, 55]" /><TresMeshStandardMaterial
          color="#386b70"
          :roughness="0.3"
      /></TresMesh>
      <TresMesh v-for="x in [-22, 0, 22]" :key="x" :position="new Vector3(x, 0, 37)"
        ><TresBoxGeometry :args="[5, 1, 24]" /><TresMeshStandardMaterial color="#80644b"
      /></TresMesh>
      <TresGroup v-for="lot in lots" :key="lot.id" :position="new Vector3(lot.x, 0, lot.z)">
        <TresMesh :position="new Vector3(0, lot.height / 2, 0)"
          ><TresBoxGeometry :args="[lot.width, lot.height, 7]" /><TresMeshStandardMaterial
            :color="colors[lot.tone]"
        /></TresMesh>
        <TresMesh :position="new Vector3(0, lot.height + 1.4, 0)" :rotation="[0, Math.PI / 4, 0]"
          ><TresConeGeometry :args="[lot.width * 0.8, 3, 4]" /><TresMeshStandardMaterial
            :color="port.styleKitId === 'iberian' ? '#a66547' : '#c9b68c'"
        /></TresMesh>
        <TresMesh :position="new Vector3(0, 1.5, 3.55)"
          ><TresBoxGeometry :args="[1.3, 3, 0.1]" /><TresMeshStandardMaterial color="#594f3c"
        /></TresMesh>
      </TresGroup>
      <TresMesh :position="new Vector3(-30, 9, 17)"
        ><TresCylinderGeometry :args="[2, 3, 18, 8]" /><TresMeshStandardMaterial color="#e9ddbd"
      /></TresMesh>
      <TresMesh :position="new Vector3(-30, 19, 17)"
        ><TresConeGeometry :args="[3, 4, 8]" /><TresMeshStandardMaterial color="#95593e"
      /></TresMesh>
    </TresCanvas>
    <div class="chart-heading">
      <span class="eyebrow">A PORT OF POSSIBILITY</span>
      <h2>{{ port.name }}</h2>
      <p>{{ port.region }}</p>
    </div>
    <div class="city-caption">
      <span class="eyebrow">港口初印象</span>
      <p>海风掠过屋顶，下一段旅程在码头等待。</p>
      <small>程序化占位场景 · 固定镜头 · 市场与招募将在后续阶段开放</small>
    </div>
  </section>
</template>
