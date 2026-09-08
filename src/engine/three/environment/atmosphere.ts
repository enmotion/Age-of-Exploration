import {
  BackSide,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  TextureLoader,
  SRGBColorSpace,
} from 'three'

// Shared linear-light atmosphere for the sky and water's reflection fallback.
export const atmosphereGLSL = /* glsl */ `
  uniform vec3 sunDirection;
  uniform vec3 moonDirection;
  uniform float daylight;
  uniform float time;
  float hash21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float noise21(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
               mix(hash21(i + vec2(0, 1)), hash21(i + 1.0), f.x), f.y);
  }
  float cloudNoise(vec2 p) {
    float n = 0.0, a = 0.55;
    for (int i = 0; i < 4; i++) {
      n += noise21(p) * a;
      p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.06 + 13.1;
      a *= 0.48;
    }
    return n;
  }
  vec3 atmosphere(vec3 ray) {
    float y = max(ray.y, 0.0);
    float dusk = (1.0 - smoothstep(0.02, 0.55, abs(sunDirection.y))) * daylight;
    float towardSun = pow(max(dot(ray, sunDirection), 0.0), 5.0);
    vec3 zenith = mix(vec3(0.003, 0.008, 0.023), vec3(0.018, 0.17, 0.52), daylight);
    zenith = mix(zenith, vec3(0.015, 0.027, 0.06), dusk * 0.85);
    vec3 horizon = mix(vec3(0.022, 0.038, 0.072), vec3(0.34, 0.57, 0.82), daylight);
    horizon = mix(horizon, mix(vec3(0.13, 0.16, 0.22), vec3(0.55, 0.29, 0.2), towardSun), dusk);
    vec3 color = mix(horizon, zenith, 1.0 - exp(-y * 8.0));
    color += vec3(0.24, 0.09, 0.045) * dusk * towardSun * exp(-y * 8.0);
    float sunDot = dot(ray, sunDirection);
    vec3 sunTint = mix(vec3(1.0, 0.32, 0.085), vec3(1.0, 0.91, 0.7), smoothstep(0.0, 0.4, sunDirection.y));
    float solarVisibility = smoothstep(-0.07, 0.025, sunDirection.y);
    color += sunTint * (pow(max(sunDot, 0.0), 28.0) * 0.3 + pow(max(sunDot, 0.0), 400.0) * 0.5) * solarVisibility;
    color += sunTint * smoothstep(0.99989, 0.99995, sunDot) * 12.0 * solarVisibility;
    float moonDot = dot(ray, moonDirection);
    color += vec3(0.46, 0.61, 0.86) * (smoothstep(0.99957, 0.99978, moonDot) * 1.5 + pow(max(moonDot, 0.0), 90.0) * 0.13) * (1.0 - daylight);
    return color;
  }
`

export function createAtmosphere(sunDirection: Vector3, moonDirection: Vector3) {
  const galaxyTexture = new TextureLoader().load('/assets/textures/milky-way.webp')
  galaxyTexture.colorSpace = SRGBColorSpace
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      sunDirection: { value: sunDirection },
      moonDirection: { value: moonDirection },
      galaxyMap: { value: galaxyTexture },
      daylight: { value: 1 },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDirection;
      ${atmosphereGLSL}
      uniform sampler2D galaxyMap;
      // Several altitude slices integrate opacity through a soft cloud body.
      float cloudDensity(vec3 p) {
        vec2 warp = vec2(noise21(p.xz * 0.37), noise21(p.xz * 0.37 + 17.0));
        float lower = cloudNoise(p.xz + warp * 1.5);
        float upper = cloudNoise(p.xz + warp * 1.5 + vec2(3.7, 8.2));
        float body = mix(lower, upper, p.y * p.y * (3.0 - 2.0 * p.y));
        float envelope = smoothstep(0.0, 0.22, p.y) * (1.0 - smoothstep(0.55, 1.0, p.y));
        return smoothstep(0.46, 0.72, body) * envelope;
      }
      void main() {
        vec3 ray = normalize(vDirection);
        vec3 color = atmosphere(ray);
        float night = 1.0 - daylight;
        vec3 starRay = vec3(ray.x, ray.y * 0.9 - ray.z * 0.436, ray.y * 0.436 + ray.z * 0.9);
        vec2 galaxyUv = vec2(fract(atan(starRay.x, starRay.z) / 6.2831853 + 0.62),
                             asin(clamp(starRay.y, -1.0, 1.0)) / 3.14159265 + 0.5);
        vec3 galaxy = texture2D(galaxyMap, galaxyUv).rgb;
        galaxyUv = (galaxyUv - vec2(0.62, 0.42)) * 3.0 + vec2(0.53, 0.55);
        float panoramaMask = smoothstep(0.0, 0.09, galaxyUv.x) * (1.0 - smoothstep(0.91, 1.0, galaxyUv.x))
          * smoothstep(0.0, 0.09, galaxyUv.y) * (1.0 - smoothstep(0.91, 1.0, galaxyUv.y));
        galaxy = texture2D(galaxyMap, clamp(galaxyUv, 0.0, 1.0)).rgb;
        float horizonFade = smoothstep(0.01, 0.2, ray.y);
        // Keep the moon from the atmosphere, and fade the panorama below the haze.
        color += galaxy * 0.75 * smoothstep(0.08, 0.3, -sunDirection.y) * horizonFade * panoramaMask;
        float dusk = 1.0 - smoothstep(0.02, 0.55, abs(sunDirection.y));
        vec3 ambientCloud = mix(vec3(0.016, 0.026, 0.05),
          mix(vec3(0.65, 0.75, 0.86), vec3(0.19, 0.16, 0.20), dusk), daylight);
        vec3 litCloud = mix(vec3(0.05, 0.073, 0.12),
          mix(vec3(1.3, 1.32, 1.34), vec3(0.48, 0.31, 0.27), dusk), daylight);
        float transmission = 1.0;
        vec3 accumulated = vec3(0.0);
        float elevation = max(0.035, ray.y + 0.055);
        for (int i = 0; i < 8; i++) {
          float altitude = (float(i) + 0.5) / 8.0;
          vec2 position = ray.xz / elevation * (2.0 + altitude * 0.65);
          position += vec2(time * 0.013, time * 0.004);
          vec3 samplePoint = vec3(position.x, altitude, position.y);
          float density = cloudDensity(samplePoint);
          float lightDepth = cloudDensity(samplePoint + sunDirection * 0.24);
          float illumination = exp(-lightDepth * 1.4) * (0.72 + altitude * 0.28);
          vec3 cloudColor = mix(ambientCloud, litCloud, illumination);
          float alpha = (1.0 - exp(-density * 0.75)) * mix(1.0, 0.33, night);
          accumulated += transmission * alpha * cloudColor;
          transmission *= 1.0 - alpha;
        }
        float cloudVisibility = smoothstep(0.04, 0.25, ray.y);
        color = mix(color, color * transmission + accumulated, cloudVisibility);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const sky = new Mesh(new SphereGeometry(1400, 32, 16), material)
  material.addEventListener('dispose', () => galaxyTexture.dispose())
  sky.frustumCulled = false
  sky.renderOrder = -10
  return sky
}
