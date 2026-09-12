import type { OceanSettings } from '../domain/ocean'

export type OceanControl = {
  key: keyof OceanSettings
  label: string
  type?: 'number' | 'check' | 'color' | 'select'
  min?: number
  max?: number
  exclusiveMin?: boolean
  integer?: boolean
  step?: number
  options?: ReadonlyArray<{ label: string; value: string }>
  disabled?: boolean
  hint?: string
  /** 依据当前取值派生的展示文本，用于把参数换算成直观数量。 */
  summary?: (value: string | number | boolean) => string
}

export type OceanControlGroup = {
  id: string
  title: string
  description?: string
  badge?: string
  controls: OceanControl[]
  children?: OceanControlGroup[]
}

const number = (
  key: keyof OceanSettings,
  label: string,
  options: Omit<OceanControl, 'key' | 'label' | 'type'> = {},
): OceanControl => ({ key, label, type: 'number', step: 0.01, ...options })

const check = (key: keyof OceanSettings, label: string): OceanControl => ({
  key,
  label,
  type: 'check',
})

const color = (key: keyof OceanSettings, label: string): OceanControl => ({
  key,
  label,
  type: 'color',
})

const bounded = (
  key: keyof OceanSettings,
  label: string,
  min: number,
  max: number,
  step = 0.01,
): OceanControl => number(key, label, { min, max, step })

const positive = (
  key: keyof OceanSettings,
  label: string,
  step = 0.01,
): OceanControl => number(key, label, { min: 0, exclusiveMin: true, step })

export const oceanControlGroups: OceanControlGroup[] = [
  {
    id: 'general',
    title: '场景与播放',
    description: '动画、曝光和整体渲染方式',
    controls: [
      check('stylized', '风格化色阶'),
      check('animationPaused', '暂停波浪'),
      bounded('animationSpeed', '动画速度', 0, 3, 0.05),
      number('timeOffset', '时间位置', { step: 0.1 }),
      bounded('exposure', '曝光', 0.2, 2, 0.05),
      bounded('contrast', '对比度', 0.4, 2, 0.05),
    ],
  },
  {
    id: 'mesh',
    title: '海面网格',
    description: '海面几何密度：细分越高，面片越多越小',
    controls: [
      number('facetResolution', '网格细分（每边）', {
        min: 24,
        max: 512,
        step: 1,
        integer: true,
        hint: '海面平面固定为 700 × 700 米。面片总数 = 细分²，单个面片边长 = 700 ÷ 细分（米）。改动会重建网格。',
        summary: (value) => {
          const segments = Number(value)
          if (!Number.isFinite(segments) || segments <= 0) return ''
          const facets = segments * segments
          const vertices = (segments + 1) * (segments + 1)
          return `${facets.toLocaleString('zh-CN')} 个面片 · ${vertices.toLocaleString('zh-CN')} 个顶点 · 面片边长 ${(700 / segments).toFixed(2)} m`
        },
      }),
      bounded('facetJitter', '面片抖动', 0, 0.5, 0.01),
    ],
  },
  {
    id: 'waves',
    title: '风浪与涌浪',
    description: '三层 Gerstner 风浪的尺度、方向与速度',
    controls: [
      number('lambda', '浪峰水平挤压', { min: 0, max: 2, step: 0.05 }),
    ],
    children: [
      {
        id: 'wind-waves',
        title: '局地风浪',
        controls: [
          bounded('localScale', '波浪能量', 0, 2, 0.05),
          bounded('windSpeed', '风速', 0.1, 8, 0.1),
          bounded('windDirection', '风向 °', -180, 180, 1),
        ],
      },
      {
        id: 'swell-waves',
        title: '远洋涌浪',
        controls: [
          bounded('swellScale', '涌浪能量', 0, 2, 0.05),
          bounded('swellWind', '推进速度', 0.1, 8, 0.1),
          bounded('swellDirection', '方向 °', -180, 180, 1),
        ],
      },
    ],
  },
  {
    id: 'layers',
    title: '大中小波分层',
    description: '每层波浪都直接改变实际几何',
    controls: [],
    children: [
      {
        id: 'large-wave',
        title: '大波 · 主轮廓',
        controls: [
          bounded('largeLength', '波长', 8, 90, 1),
          bounded('largeVertical', '浪高', 0, 2, 0.05),
          bounded('largeHorizontal', '前倾', 0, 2, 0.05),
        ],
      },
      {
        id: 'medium-wave',
        title: '中波 · 浪脊',
        controls: [
          bounded('mediumLength', '波长', 3, 35, 0.5),
          bounded('mediumVertical', '浪高', 0, 2, 0.05),
          bounded('mediumHorizontal', '前倾', 0, 2, 0.05),
        ],
      },
      {
        id: 'small-wave',
        title: '小波 · 近景细节',
        controls: [
          bounded('smallLength', '波长', 0.8, 14, 0.1),
          bounded('smallVertical', '浪高', 0, 2, 0.05),
          bounded('smallHorizontal', '前倾', 0, 2, 0.05),
        ],
      },
    ],
  },
  {
    id: 'style',
    title: '折面、明暗与水色',
    description: '参考图风格的主要美术控制',
    controls: [
      bounded('facetStrength', '面片明暗差异', 0, 1, 0.02),
      bounded('toneSteps', '明暗色阶', 1, 12, 1),
      bounded('shadingContrast', '明暗对比', 0.2, 3, 0.05),
      color('waterColor', '基础海蓝'),
      color('valleyColor', '浪谷深蓝'),
      color('slopeColor', '浪坡青蓝'),
      color('crestColor', '浪尖浅青'),
      bounded('heightColorStrength', '高度调色', 0, 2, 0.05),
      bounded('slopeColorStrength', '坡度调色', 0, 4, 0.05),
      bounded('saturation', '饱和度', 0, 2, 0.05),
      bounded('brightness', '亮度', 0.2, 2, 0.05),
      bounded('sssStrength', '浪峰透光', 0, 2, 0.05),
    ],
  },
  {
    id: 'lighting',
    title: '天空与碎金光路',
    description: '太阳位置、天空亮度和水面反光',
    controls: [
      bounded('inclination', '太阳高度', -0.18, 1.25, 0.01),
      bounded('azimuth', '太阳方位', -3.14, 3.14, 0.02),
      bounded('luminance', '天空亮度', 0.08, 1.5, 0.02),
      bounded('envIntensity', '环境光', 0, 2, 0.05),
      bounded('lightIntensity', '太阳光', 0, 3, 0.05),
      color('highlightColor', '反光颜色'),
      bounded('highlightStrength', '反光强度', 0, 2, 0.05),
      bounded('highlightSharpness', '反光锐度', 2, 160, 1),
      bounded('glintScale', '碎金尺度', 0.02, 1, 0.01),
      bounded('glintThreshold', '碎金阈值', -1, 1, 0.02),
    ],
  },
  {
    id: 'foam',
    title: '浪尖白沫',
    description: '白沫沿三层浪脊生成并由噪声打散',
    controls: [
      check('crestFoam', '启用浪尖白沫'),
      color('foamColor', '白沫颜色'),
      bounded('foam', '覆盖强度', 0, 4, 0.05),
      bounded('foamBiasLarge', '大波阈值', 0, 1.5, 0.02),
      bounded('foamBiasMedium', '中波阈值', 0, 1.5, 0.02),
      bounded('foamBiasSmall', '小波阈值', 0, 1.5, 0.02),
      bounded('foamHeightWeight', '浪高响应', 0, 1, 0.02),
      bounded('foamSlopeWeight', '坡度响应', 0, 2, 0.02),
      bounded('foamBreakup', '破碎阈值', 0, 1, 0.02),
    ],
  },
  {
    id: 'vessel',
    title: '船体、尾迹与浮力',
    description: '船体随相同波场运动，尾迹独立着色',
    controls: [
      check('buoyancy', '启用船体起伏'),
      bounded('heaveScale', '升沉幅度', 0, 2, 0.05),
      bounded('rollScale', '横摇幅度', 0, 3, 0.05),
      bounded('pitchScale', '纵摇幅度', 0, 3, 0.05),
      check('wakeEnabled', '启用 V 型尾迹'),
      bounded('wakeInitialWidth', '起始宽度', 0.1, 5, 0.05),
      bounded('wakeSpreadSpeed', '扩散倍率', 0, 2, 0.05),
      bounded('wakeAngle', '开口角 °', 2, 70, 1),
      color('wakeColor', '尾迹白沫'),
      bounded('wakeBrightness', '尾迹亮度', 0, 4, 0.05),
      bounded('wakeBreakup', '尾迹破碎', 0, 1, 0.02),
      bounded('wakeLifetime', '尾迹长度', 2, 13, 0.25),
    ],
  },
  {
    id: 'environment',
    title: '雾与镜头',
    description: '远景空气透视和观察位置',
    controls: [
      {
        key: 'fogMode',
        label: '雾模式',
        type: 'select',
        options: [
          { label: '关闭', value: 'none' },
          { label: '线性', value: 'linear' },
          { label: '指数', value: 'exp' },
          { label: '指数平方', value: 'exp2' },
        ],
      },
      color('fogColor', '雾颜色'),
      number('fogStart', '雾起点', { min: 0, step: 5 }),
      positive('fogEnd', '雾终点', 5),
      bounded('fogDensity', '雾密度', 0, 0.02, 0.0001),
      bounded('cameraFov', '镜头视场角', 25, 90, 1),
      bounded('cameraSpeed', '镜头移动速度', 0.2, 12, 0.1),
      check('zqsd', '使用 ZQSD 键位'),
    ],
  },
]
