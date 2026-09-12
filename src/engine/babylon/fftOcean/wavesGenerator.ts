// @ts-nocheck -- Upstream Babylon 5 source port; runtime compatibility is covered by browser tests.
import * as BABYLON from '@babylonjs/core'
import { FFT } from './fft'
import { RTTDebug } from './tools/RTTDebug'
import { WavesCascade } from './wavesCascade'
import { WavesSettings } from './wavesSettings'

export class WavesGenerator {
  public lengthScale: number[]
  public timeScale = 1
  public timeOffset = 0
  public paused = false
  public foamDecay = 0.5

  private _engine: BABYLON.Engine
  private _rttDebug: RTTDebug
  private _fft: FFT
  private _noise: BABYLON.Texture
  private _cascades: WavesCascade[]
  private _displacementMap: BABYLON.Nullable<Uint16Array>
  private _wavesSettings: WavesSettings
  private _simulationTime: number
  private _lastUpdateTime: number
  private _heightRange = {
    min: 0,
    max: 0,
    nonZeroSamples: 0,
    rawMin: 0,
    rawMax: 0,
    viewType: 'pending',
  }
  private _initialSpectrumRange = { min: 0, max: 0 }

  public getCascade(num: number) {
    return this._cascades[num]
  }

  public get waterHeightMap() {
    return this._displacementMap
  }

  public get waterHeightMapScale() {
    return this.lengthScale[0]
  }

  public get waterHeightRange() {
    return this._heightRange
  }

  public get initialSpectrumRange() {
    return this._initialSpectrumRange
  }

  constructor(
    size: number,
    wavesSettings: WavesSettings,
    scene: BABYLON.Scene,
    rttDebug: RTTDebug,
    noise: BABYLON.Nullable<ArrayBuffer>,
  ) {
    this._engine = scene.getEngine()
    this._rttDebug = rttDebug
    this._displacementMap = null
    this._wavesSettings = wavesSettings
    this._simulationTime = 0
    this._lastUpdateTime = new Date().getTime() / 1000

    this._fft = new FFT(scene.getEngine(), scene, this._rttDebug, 1, size)
    this._noise = this._generateNoiseTexture(size, noise)

    this._rttDebug.setTexture(0, 'noise', this._noise)

    this.lengthScale = [250, 17, 5]

    this._cascades = [
      new WavesCascade(
        size,
        this._noise,
        this._fft,
        this._rttDebug,
        2,
        this._engine,
      ),
      new WavesCascade(
        size,
        this._noise,
        this._fft,
        this._rttDebug,
        12,
        this._engine,
      ),
      new WavesCascade(
        size,
        this._noise,
        this._fft,
        this._rttDebug,
        22,
        this._engine,
      ),
    ]

    this.initializeCascades()
  }

  public initializeCascades(): void {
    let boundary1 = 0.0001
    for (let i = 0; i < this.lengthScale.length; ++i) {
      const boundary2 =
        i < this.lengthScale.length - 1
          ? ((2 * Math.PI) / this.lengthScale[i + 1]) * 6
          : 9999
      this._cascades[i].calculateInitials(
        this._wavesSettings,
        this.lengthScale[i],
        boundary1,
        boundary2,
      )
      boundary1 = boundary2
    }
    this._cascades[0].initialSpectrum
      .readPixels(undefined, undefined, undefined, undefined, true)
      ?.then((buffer: ArrayBufferView) => {
        const values = new Float32Array(
          buffer.buffer,
          buffer.byteOffset,
          buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
        )
        let min = Number.POSITIVE_INFINITY
        let max = Number.NEGATIVE_INFINITY
        for (let index = 0; index < values.length; index += 37) {
          min = Math.min(min, values[index])
          max = Math.max(max, values[index])
        }
        if (Number.isFinite(min) && Number.isFinite(max)) {
          this._initialSpectrumRange = { min, max }
        }
      })
  }

  public update(): void {
    const now = new Date().getTime() / 1000
    const delta = Math.min(Math.max(now - this._lastUpdateTime, 0), 0.5)
    this._lastUpdateTime = now
    if (!this.paused) {
      this._simulationTime += delta * this.timeScale
    }
    const time = this._simulationTime + this.timeOffset
    for (let i = 0; i < this._cascades.length; ++i) {
      this._cascades[i].foamDecay = this.foamDecay
      this._cascades[i].calculateWavesAtTime(time)
    }
    this._getDisplacementMap()
  }

  public dispose(): void {
    for (let i = 0; i < this._cascades.length; ++i) {
      this._cascades[i].dispose()
    }
    this._noise.dispose()
    this._fft.dispose()
  }

  private _getDisplacementMap(): void {
    this._cascades[0].displacement
      .readPixels(undefined, undefined, undefined, undefined, true)
      ?.then((buffer: ArrayBufferView) => {
        this._displacementMap = new Uint16Array(
          buffer.buffer,
          buffer.byteOffset,
          buffer.byteLength / Uint16Array.BYTES_PER_ELEMENT,
        )
        let min = Number.POSITIVE_INFINITY
        let max = Number.NEGATIVE_INFINITY
        let rawMin = Number.POSITIVE_INFINITY
        let rawMax = Number.NEGATIVE_INFINITY
        let nonZeroSamples = 0
        for (
          let index = 1;
          index < this._displacementMap.length;
          index += 148
        ) {
          const rawHeight = this._displacementMap[index]
          const height = BABYLON.TextureTools.FromHalfFloat(rawHeight)
          min = Math.min(min, height)
          max = Math.max(max, height)
          rawMin = Math.min(rawMin, rawHeight)
          rawMax = Math.max(rawMax, rawHeight)
          if (rawHeight !== 0) nonZeroSamples += 1
        }
        if (Number.isFinite(min) && Number.isFinite(max)) {
          this._heightRange = {
            min,
            max,
            nonZeroSamples,
            rawMin,
            rawMax,
            viewType: buffer.constructor.name,
          }
        }
      })
  }

  private _normalRandom(): number {
    return (
      Math.cos(2 * Math.PI * Math.random()) *
      Math.sqrt(-2 * Math.log(Math.random()))
    )
  }

  private _generateNoiseTexture(
    size: number,
    noiseBuffer: BABYLON.Nullable<ArrayBuffer>,
  ): BABYLON.Texture {
    const numChannels = noiseBuffer ? 4 : 2
    const data = new Float32Array(size * size * numChannels)

    if (noiseBuffer) {
      const buf = new Uint8Array(noiseBuffer)
      const tmpUint8 = new Uint8Array(4)
      const tmpFloat = new Float32Array(tmpUint8.buffer, 0, 1)

      let offset = 0x094b
      let dataOffset = 0
      for (let j = 0; j < 256; ++j) {
        offset += 8
        offset += 256 * 4 // A channel
        offset += 256 * 4 // B channel
        for (let i = 0; i < 256; ++i) {
          // G channel
          tmpUint8[0] = buf[offset++]
          tmpUint8[1] = buf[offset++]
          tmpUint8[2] = buf[offset++]
          tmpUint8[3] = buf[offset++]
          data[dataOffset + 1 + i * 4] = tmpFloat[0]
        }
        for (let i = 0; i < 256; ++i) {
          // R channel
          tmpUint8[0] = buf[offset++]
          tmpUint8[1] = buf[offset++]
          tmpUint8[2] = buf[offset++]
          tmpUint8[3] = buf[offset++]
          data[dataOffset + 0 + i * 4] = tmpFloat[0]
        }
        for (let i = 0; i < 256; ++i) {
          // A channel
          data[dataOffset + 3 + i * 4] = 1
        }
        dataOffset += 256 * 4
      }
    } else {
      for (let i = 0; i < size; ++i) {
        for (let j = 0; j < size; ++j) {
          data[j * size * 2 + i * 2 + 0] = this._normalRandom()
          data[j * size * 2 + i * 2 + 1] = this._normalRandom()
        }
      }
    }

    const noise = new BABYLON.RawTexture(
      data,
      size,
      size,
      numChannels === 2
        ? BABYLON.Constants.TEXTUREFORMAT_RG
        : BABYLON.Constants.TEXTUREFORMAT_RGBA,
      this._engine,
      false,
      false,
      BABYLON.Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      BABYLON.Constants.TEXTURETYPE_FLOAT,
    )
    noise.name = 'noise'

    return noise
  }
}
