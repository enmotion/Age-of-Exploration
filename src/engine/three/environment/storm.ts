import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Vector2,
} from 'three'
import { wavesGLSL, waveScaleForWind } from './waves'

const MAX_DROPS = 2200
const SPRAY_CLUSTERS = 192
const SPRAY_PER_CLUSTER = 48
const MAX_SPRAY = SPRAY_CLUSTERS * SPRAY_PER_CLUSTER

/** Camera-local rain field. The GPU wraps drops, so storms add no per-drop CPU work. */
export function createStorm() {
  let seed = 1492
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const values = new Float32Array(MAX_DROPS * 3)
  for (let i = 0; i < MAX_DROPS; i++) {
    values[i * 3] = (random() - 0.5) * 180
    values[i * 3 + 1] = random() * 100
    values[i * 3 + 2] = (random() - 0.5) * 180
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(values, 3))
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      time: { value: 0 },
      strength: { value: 0 },
      windAngle: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float time;
      uniform float strength;
      uniform float windAngle;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float fall = time * mix(42.0, 75.0, strength);
        p.y = mod(p.y - fall, 100.0) - 18.0;
        vec2 wind = vec2(sin(windAngle), -cos(windAngle));
        p.xz += wind * (100.0 - p.y) * strength * 0.24;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = mix(1.0, 2.2, strength) * (110.0 / max(25.0, -mv.z));
        vAlpha = strength * (1.0 - smoothstep(18.0, 100.0, length(p.xz)));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float streak = (1.0 - smoothstep(0.0, 0.16, abs(q.x))) *
          (1.0 - smoothstep(0.15, 0.5, abs(q.y)));
        if (streak <= 0.01) discard;
        gl_FragColor = vec4(0.63, 0.78, 0.86, streak * vAlpha * 0.72);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const rain = new Points(geometry, material)
  rain.frustumCulled = false
  rain.renderOrder = 4
  rain.visible = false
  const sprayValues = new Float32Array(MAX_SPRAY * 3)
  const sprayData = new Float32Array(MAX_SPRAY * 3)
  for (let cluster = 0; cluster < SPRAY_CLUSTERS; cluster++) {
    // More clusters near the camera; the whole field follows the camera in update().
    const radius = 5 + Math.pow(random(), 1.65) * 80
    const angle = random() * Math.PI * 2
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    const clusterSeed = random()
    for (let member = 0; member < SPRAY_PER_CLUSTER; member++) {
      const i = cluster * SPRAY_PER_CLUSTER + member
      sprayValues[i * 3] = x
      sprayValues[i * 3 + 1] = 0
      sprayValues[i * 3 + 2] = z
      // Long and dense along the crest, narrow across the wind direction.
      sprayData[i * 3] = (random() + random() - 1) * 5.2
      sprayData[i * 3 + 1] = (random() + random() - 1) * 0.75
      sprayData[i * 3 + 2] = (clusterSeed + (random() - 0.5) * 0.055 + 1) % 1
    }
  }
  const sprayGeometry = new BufferGeometry()
  sprayGeometry.setAttribute('position', new Float32BufferAttribute(sprayValues, 3))
  sprayGeometry.setAttribute('sprayData', new Float32BufferAttribute(sprayData, 3))
  const sprayMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      time: { value: 0 },
      strength: { value: 0 },
      windAngle: { value: 0 },
      waveScale: { value: 1 },
      offset: { value: new Vector2() },
      daylight: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float time;
      uniform float strength;
      uniform float windAngle;
      uniform float waveScale;
      uniform vec2 offset;
      attribute vec3 sprayData;
      varying float vAlpha;
      varying float vLife;
      ${wavesGLSL}
      void main() {
        vec2 wind = vec2(sin(windAngle), -cos(windAngle));
        vec2 tangent = vec2(-wind.y, wind.x);
        vec2 crestOffset = tangent * sprayData.x + wind * sprayData.y;
        vec2 localPoint = position.xz + crestOffset;
        vec2 samplePoint = localPoint + offset;
        vec4 field = windWaveField(samplePoint, time, windAngle);
        float seed = sprayData.z;
        float life = fract(time * mix(0.32, 0.72, strength) + seed);
        float crest = smoothstep(0.4, 0.7, field.w * waveScale);
        vec2 displaced = waveDisplacement(samplePoint, time, windAngle) *
          (0.2 + strength) * waveScale;
        vec3 p = vec3(localPoint.x + displaced.x, field.x * waveScale, localPoint.y + displaced.y);
        float lift = sin(life * 3.14159) * mix(0.45, 3.4, strength);
        p.y += lift;
        p.xz += wind * life * life * mix(0.6, 5.5, strength);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = mix(0.85, 2.6, strength) * (100.0 / max(22.0, -mv.z));
        vLife = life;
        float cameraDetail = mix(0.16, 1.0, 1.0 - smoothstep(10.0, 78.0, length(position.xz)));
        vAlpha = crest * strength * sin(life * 3.14159) *
          cameraDetail * (1.0 - smoothstep(78.0, 88.0, length(position.xz)));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float daylight;
      varying float vAlpha;
      varying float vLife;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float drop = 1.0 - smoothstep(0.16, 0.48, length(q));
        float breakup = 0.82 + 0.18 * sin((q.x + q.y + vLife) * 31.0);
        float alpha = drop * breakup * vAlpha;
        if (alpha <= 0.015) discard;
        vec3 color = mix(vec3(0.34, 0.44, 0.48), vec3(0.68, 0.79, 0.8), daylight);
        gl_FragColor = vec4(color * mix(0.62, 1.0, daylight), alpha * mix(0.42, 0.68, daylight));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const spray = new Points(sprayGeometry, sprayMaterial)
  spray.frustumCulled = false
  spray.renderOrder = 3
  spray.visible = false
  return {
    rain,
    spray,
    update(
      time: number,
      windSpeed: number,
      windHeading: number,
      enabled: boolean,
      sprayEnabled: boolean,
      detail: number,
      offsetX: number,
      offsetZ: number,
      daylight: number,
      cameraX: number,
      cameraZ: number,
    ) {
      const strength = enabled ? Math.min(1, Math.max(0, (windSpeed - 14) / 14)) : 0
      const sprayStrength = sprayEnabled ? Math.min(1, Math.max(0, (windSpeed - 15) / 15)) : 0
      rain.visible = strength > 0.01
      spray.visible = sprayStrength > 0.01
      geometry.setDrawRange(0, Math.round(MAX_DROPS * detail))
      sprayGeometry.setDrawRange(0, Math.round(MAX_SPRAY * detail))
      material.uniforms.time!.value = time
      material.uniforms.strength!.value = strength
      material.uniforms.windAngle!.value = (windHeading * Math.PI) / 180
      sprayMaterial.uniforms.time!.value = time
      sprayMaterial.uniforms.strength!.value = sprayStrength
      sprayMaterial.uniforms.windAngle!.value = (windHeading * Math.PI) / 180
      sprayMaterial.uniforms.waveScale!.value = waveScaleForWind(windSpeed)
      rain.position.set(cameraX, 0, cameraZ)
      spray.position.set(cameraX, 0, cameraZ)
      sprayMaterial.uniforms.offset!.value.set(offsetX + cameraX, offsetZ + cameraZ)
      sprayMaterial.uniforms.daylight!.value = daylight
      return strength
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      sprayGeometry.dispose()
      sprayMaterial.dispose()
    },
  }
}
