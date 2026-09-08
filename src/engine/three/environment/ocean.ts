import { Matrix4, PlaneGeometry, ShaderMaterial, Vector2, Vector3, Vector4 } from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { atmosphereGLSL } from './atmosphere'
import { ISLAND_RADIUS } from './island'
import { wavesGLSL } from './waves'

export function createOcean(sunDirection: Vector3, moonDirection: Vector3) {
  const geometry = new PlaneGeometry(2800, 2800, 256, 256)
  const positions = geometry.attributes.position!
  // Concentrate vertices near the ship; far waves only need a coarse silhouette.
  for (let i = 0; i < positions.count; i++) {
    for (const axis of [0, 1]) {
      const value = positions.getComponent(i, axis) / 1400
      positions.setComponent(i, axis, Math.sign(value) * Math.pow(Math.abs(value), 1.6) * 1400)
    }
  }
  geometry.computeBoundingSphere()
  const ocean = new Reflector(geometry, {
    textureWidth: 768,
    textureHeight: 768,
    multisample: 0,
    clipBias: 0.003,
    shader: {
      name: 'OceanWithIslandReflection',
      uniforms: {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: new Matrix4() },
        sunDirection: { value: sunDirection },
        moonDirection: { value: moonDirection },
        time: { value: 0 },
        daylight: { value: 1 },
        offset: { value: new Vector2() },
        islandCenter: { value: new Vector2() },
        nightLights: { value: Array.from({ length: 4 }, () => new Vector4()) },
      },
      vertexShader: /* glsl */ `
        uniform float time;
        uniform vec2 offset;
        uniform vec2 islandCenter;
        uniform mat4 textureMatrix;
        varying vec3 vWorld;
        varying vec4 vReflection;
        varying float vAttenuation;
        ${wavesGLSL}
        void main() {
          vec3 p = position;
          vec2 local = vec2(p.x, -p.y);
          vec2 samplePoint = local + offset;
          vec4 field = waveField(samplePoint, time);
          float shore = length((local - islandCenter) / vec2(1.0, 0.72)) - ${ISLAND_RADIUS.toFixed(1)};
          float attenuation = mix(0.12, 1.0, smoothstep(-5.0, 28.0, shore));
          p.z = field.x * attenuation;
          vAttenuation = attenuation;
          vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
          vReflection = textureMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec4 nightLights[4];
        uniform vec2 offset;
        uniform vec2 islandCenter;
        varying vec3 vWorld;
        varying vec4 vReflection;
        varying float vAttenuation;
        ${atmosphereGLSL}
        ${wavesGLSL}
        float glitter(vec3 n, vec3 v, vec3 l, float roughness) {
          vec3 h = normalize(v + l);
          float nh = max(dot(n, h), 0.0);
          float a2 = roughness * roughness;
          float d = nh * nh * (a2 - 1.0) + 1.0;
          return a2 / (3.14159 * d * d) * max(dot(n, l), 0.0);
        }
        float rippleHeight(vec2 p) {
          return noise21(p) * 0.7 + noise21(p * 2.13 + 5.7) * 0.3;
        }
        void main() {
          vec2 p = vWorld.xz + offset;
          float distanceToCamera = length(cameraPosition - vWorld);
          float detail = 1.0 - smoothstep(90.0, 420.0, distanceToCamera);
          vec4 field = waveField(p, time);
          vec2 rippleUv = p * 0.42 + vec2(time * 0.12, -time * 0.08);
          rippleUv += vec2(noise21(p * 0.08), noise21(p * 0.08 + 19.0)) * 1.3;
          float centerHeight = rippleHeight(rippleUv);
          vec2 ripple = vec2(rippleHeight(rippleUv + vec2(0.18, 0.0)) - centerHeight,
                             rippleHeight(rippleUv + vec2(0.0, 0.18)) - centerHeight) * 0.65 * detail;
          vec3 normal = normalize(vec3(-field.y * vAttenuation + ripple.x, 1.0, -field.z * vAttenuation + ripple.y));
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float facing = max(dot(normal, viewDir), 0.0);
          float fresnel = 0.0204 + 0.9796 * pow(1.0 - facing, 5.0);
          vec2 coast = (vWorld.xz - islandCenter) / vec2(1.0, 0.72);
          float angle = atan(coast.y, coast.x);
          float coastRadius = ${ISLAND_RADIUS.toFixed(1)} * (1.0 + 0.09 * sin(angle * 3.0) + 0.05 * cos(angle * 5.0));
          float shoreDistance = length(coast) - coastRadius;
          float shallow = 1.0 - smoothstep(0.0, 36.0, shoreDistance);
          vec3 deepWater = vec3(0.006, 0.035, 0.063);
          vec3 shallowWater = vec3(0.025, 0.42, 0.34);
          vec3 water = mix(deepWater, shallowWater, shallow * 0.86);
          water *= mix(0.1, 1.0, daylight);
          water *= 0.7 + max(dot(normal, sunDirection), 0.0) * 0.4;
          water += vec3(0.008, 0.075, 0.07) * max(field.x, 0.0) * daylight * 0.5;
          vec3 reflectedRay = reflect(-viewDir, normal);
          vec3 skyReflection = atmosphere(reflectedRay);
          vec2 reflectionUv = vReflection.xy / vReflection.w;
          reflectionUv += normal.xz * 0.075 / max(1.0, distanceToCamera * 0.012);
          vec3 reflection = texture2D(tDiffuse, clamp(reflectionUv, 0.004, 0.996)).rgb * 0.5;
          reflection += texture2D(tDiffuse, clamp(reflectionUv + vec2(0.002, 0.001), 0.004, 0.996)).rgb * 0.25;
          reflection += texture2D(tDiffuse, clamp(reflectionUv - vec2(0.002, 0.001), 0.004, 0.996)).rgb * 0.25;
          float edge = smoothstep(0.0, 0.06, reflectionUv.x) * (1.0 - smoothstep(0.94, 1.0, reflectionUv.x));
          edge *= smoothstep(0.0, 0.06, reflectionUv.y) * (1.0 - smoothstep(0.94, 1.0, reflectionUv.y));
          reflection = mix(skyReflection, reflection, edge * 0.9);
          vec3 color = mix(water, reflection, clamp(fresnel, 0.035, 0.92));
          float sunVisible = smoothstep(-0.025, 0.08, sunDirection.y);
          vec3 solarColor = mix(vec3(1.0, 0.3, 0.07), vec3(1.0, 0.9, 0.69), smoothstep(0.0, 0.45, sunDirection.y));
          color += solarColor * min(8.0, glitter(normal, viewDir, sunDirection, 0.065)) * 0.18 * sunVisible;
          color += vec3(0.33, 0.49, 0.8) * min(6.0, glitter(normal, viewDir, moonDirection, 0.08)) * 0.10 * (1.0 - daylight);
          for (int i = 0; i < 4; i++) {
            vec3 toLight = nightLights[i].xyz - vWorld;
            float d2 = dot(toLight, toLight);
            float attenuation = nightLights[i].w / (1.0 + d2 * 0.012);
            vec3 lightDir = normalize(toLight);
            float sparkle = min(12.0, glitter(normal, viewDir, lightDir, 0.12));
            color += vec3(1.0, 0.38, 0.075) * attenuation * (0.12 + sparkle * 0.24);
          }
          float foamNoise = noise21(p * 0.6 + time * 0.08);
          float breaker = smoothstep(0.6, 0.96, sin(shoreDistance * 0.85 - time * 1.65 + foamNoise * 2.0));
          float foam = breaker * (1.0 - smoothstep(1.0, 12.0, shoreDistance)) * smoothstep(-2.0, 1.0, shoreDistance);
          // New whitecaps form at compressed crests. Two delayed samples approximate
          // the short-lived foam left behind a passing breaker (no simulation texture).
          vec2 drift = vec2(0.28, 0.12);
          vec2 foamUv = p - drift * time;
          float coverage = noise21(foamUv * 0.065 + 12.0);
          float threshold = mix(0.57, 0.83, coverage);
          float fresh = smoothstep(threshold, threshold + 0.18, field.w);
          float remnant = smoothstep(threshold, threshold + 0.18, previousCrest(p - drift * 0.7, time - 0.7)) * 0.5;
          remnant = max(remnant, smoothstep(threshold, threshold + 0.18, previousCrest(p - drift * 1.5, time - 1.5)) * 0.2);
          float cellular = noise21(foamUv * mix(0.85, 3.2, detail) + foamNoise * 1.2);
          float threads = 1.0 - smoothstep(0.035, 0.16, abs(cellular - 0.5));
          float foamBreakup = smoothstep(0.32, 0.6, noise21(foamUv * 0.23 + vec2(foamNoise, 0.0)));
          float whitecap = max(fresh, remnant) * foamBreakup * (0.08 + threads * 0.92);
          whitecap *= smoothstep(0.25, 0.9, vAttenuation) * (1.0 - smoothstep(240.0, 650.0, distanceToCamera));
          foam = max(foam, whitecap * 0.72);
          vec3 foamLight = mix(vec3(0.075, 0.11, 0.17), vec3(0.64, 0.75, 0.79), daylight);
          foamLight += solarColor * max(dot(normal, sunDirection), 0.0) * 0.22 * sunVisible;
          color = mix(color, foamLight, clamp(foam, 0.0, 0.9));
          float haze = 1.0 - exp(-distanceToCamera * distanceToCamera * 0.00000065);
          color = mix(color, atmosphere(normalize(vec3(viewDir.x * -1.0, 0.015, viewDir.z * -1.0))), haze * 0.86);
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    },
  })
  ocean.rotation.x = -Math.PI / 2
  ocean.frustumCulled = false
  const material = ocean.material as ShaderMaterial
  // Reflector clones uniforms; restore the shared celestial direction references.
  material.uniforms.sunDirection!.value = sunDirection
  material.uniforms.moonDirection!.value = moonDirection
  return { ocean, material }
}
