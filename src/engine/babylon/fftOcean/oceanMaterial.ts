// @ts-nocheck -- Upstream Babylon 5 source port; runtime compatibility is covered by browser tests.
import * as BABYLON from "@babylonjs/core";
import { WavesGenerator } from "./wavesGenerator";
import { PBRCustomMaterial } from "@babylonjs/materials";

const foamPicture = "./assets/fft-ocean-foam.jpg";

export class OceanMaterial {

    private _wavesGenerator: WavesGenerator;
    private _depthRenderer: BABYLON.DepthRenderer;
    private _scene: BABYLON.Scene;
    private _camera: BABYLON.Camera;
    private _foamTexture: BABYLON.Texture;
    private _startTime: number;

    constructor(depthRenderer: BABYLON.DepthRenderer, scene: BABYLON.Scene) {
        this._wavesGenerator = null as any;
        this._depthRenderer = depthRenderer;
        this._scene = scene;
        this._camera = scene.activeCameras?.[0] ?? scene.activeCamera!;
        this._foamTexture = new BABYLON.Texture(foamPicture, this._scene);
        this._startTime = new Date().getTime() / 1000;
    }

    public setWavesGenerator(wavesGenerator: WavesGenerator): void {
        this._wavesGenerator = wavesGenerator;
    }

    public readMaterialParameter(mat: PBRCustomMaterial, name: string): any {
        const tmp = new BABYLON.Color3();
        for (const param in mat._newUniformInstances) {
            const [ptype, pname] = param.split('-');
            let val = mat._newUniformInstances[param];
            if (pname === name) {
                if (ptype === "vec3") {
                    // all vec3 types are color in the shader
                    val = val as BABYLON.Vector3;
                    tmp.copyFromFloats(val.x, val.y, val.z);
                    tmp.toGammaSpaceToRef(tmp);
                    val = tmp.toHexString();
                }
                return val;
            }
        }
        return null;
    }

    public updateMaterialParameter(mat: PBRCustomMaterial, name: string, value: any): void {
        const tmp = new BABYLON.Vector3();
        for (const param in mat._newUniformInstances) {
            const [ptype, pname] = param.split('-');
            if (pname === name) {
                if (ptype === "vec3") {
                    // all vec3 types are color in the shader
                    value = BABYLON.Color3.FromHexString(value);
                    value = value.toLinearSpaceToRef(value);
                    tmp.copyFromFloats(value.r, value.g, value.b);
                    value = tmp;
                }
                mat._newUniformInstances[param] = value;
                return;
            }
        }
    }

    public async getMaterial(useMid: boolean, useClose: boolean, useNodeMaterial = false): Promise<BABYLON.Material> {
        let mat: BABYLON.NodeMaterial | PBRCustomMaterial;

        if (!useNodeMaterial) {

            mat = new PBRCustomMaterial("oceanMat" + (useMid ? "1" : "0") + (useClose ? "1" : "0"), this._scene);

            mat.metallic = 0;
            mat.roughness = 0.311;
            mat.forceIrradianceInFragment = true;
            //mat.realTimeFiltering = true;
            //mat.realTimeFilteringQuality = BABYLON.Constants.TEXTURE_FILTERING_QUALITY_HIGH;
            //mat.wireframe = true;

            const color = new BABYLON.Vector3(0.011126082368383245, 0.05637409755197975, 0.09868919754109445);

            mat.AddUniform("_Color", "vec3", color);
            mat.AddUniform("_MaxGloss", "float", 0.91);
            mat.AddUniform("_RoughnessScale", "float", 0.0044);
            mat.AddUniform("_LOD_scale", "float", 7.13);

            mat.AddUniform("_Stylized", "float", 1);
            mat.AddUniform("_SeaLevel", "float", 0);
            mat.AddUniform("_VerticalScale0", "float", 1);
            mat.AddUniform("_VerticalScale1", "float", 1);
            mat.AddUniform("_VerticalScale2", "float", 0.7);
            mat.AddUniform("_HorizontalScale0", "float", 1);
            mat.AddUniform("_HorizontalScale1", "float", 1);
            mat.AddUniform("_HorizontalScale2", "float", 0.8);
            mat.AddUniform("_NormalWeight0", "float", 1);
            mat.AddUniform("_NormalWeight1", "float", 0.85);
            mat.AddUniform("_NormalWeight2", "float", 0.35);
            mat.AddUniform("_FoamWeight0", "float", 1);
            mat.AddUniform("_FoamWeight1", "float", 1);
            mat.AddUniform("_FoamWeight2", "float", 0.5);
            mat.AddUniform("_WaveFadeStart", "float", 900);
            mat.AddUniform("_WaveFadeEnd", "float", 2200);
            mat.AddUniform("_FacetFadeStart", "float", 140);
            mat.AddUniform("_FacetFadeEnd", "float", 700);
            mat.AddUniform("_NormalFadeStart", "float", 220);
            mat.AddUniform("_NormalFadeEnd", "float", 1000);

            mat.AddUniform("_ValleyColor", "vec3", new BABYLON.Vector3(0.0018, 0.0513, 0.1247));
            mat.AddUniform("_SlopeColor", "vec3", new BABYLON.Vector3(0.0024, 0.2158, 0.3515));
            mat.AddUniform("_CrestColor", "vec3", new BABYLON.Vector3(0.0886, 0.5708, 0.6584));
            mat.AddUniform("_FacetStrength", "float", 0.72);
            mat.AddUniform("_DetailNormalStrength", "float", 0.82);
            mat.AddUniform("_NormalScaleX", "float", 1);
            mat.AddUniform("_NormalScaleZ", "float", 1);
            mat.AddUniform("_ShadingContrast", "float", 1.25);
            mat.AddUniform("_ShadingBias", "float", 0.08);
            mat.AddUniform("_ToneSteps", "float", 7);
            mat.AddUniform("_ToneTransition", "float", 0.35);
            mat.AddUniform("_ColorPatches", "float", 1);
            mat.AddUniform("_PatchScale", "float", 11);
            mat.AddUniform("_PatchStrength", "float", 0.09);
            mat.AddUniform("_PatchSpeed", "vec2", new BABYLON.Vector2(0.03, -0.015));
            mat.AddUniform("_HeightColorStrength", "float", 0.65);
            mat.AddUniform("_HeightColorBias", "float", 0.48);
            mat.AddUniform("_SlopeColorStrength", "float", 1.2);
            mat.AddUniform("_SlopeColorBias", "float", -0.1);
            mat.AddUniform("_LightColorStrength", "float", 0.18);
            mat.AddUniform("_Saturation", "float", 1.08);
            mat.AddUniform("_Brightness", "float", 1);

            mat.AddUniform("_FresnelStrength", "float", 1);
            mat.AddUniform("_FresnelBias", "float", 0);
            mat.AddUniform("_HighlightColor", "vec3", new BABYLON.Vector3(1, 0.7913, 0.491));
            mat.AddUniform("_HighlightStrength", "float", 0.22);
            mat.AddUniform("_HighlightSharpness", "float", 96);
            mat.AddUniform("_GlintScale", "float", 0.22);
            mat.AddUniform("_GlintAspect", "float", 4);
            mat.AddUniform("_GlintAngle", "float", 18);
            mat.AddUniform("_GlintThreshold", "float", 0.48);
            mat.AddUniform("_GlintDistortion", "float", 0.22);

            mat.AddUniform("_FoamColor", "vec3", new BABYLON.Vector3(1, 1, 1));
            mat.AddUniform("_FoamScale", "float", 2.4);
            mat.AddUniform("_ContactFoam", "float", 1);
            mat.AddUniform("_FoamBiasLOD0", "float", 0.84);
            mat.AddUniform("_FoamBiasLOD1", "float", 0.99);
            mat.AddUniform("_FoamBiasLOD2", "float", 0.89);
            mat.AddUniform("_CrestFoam", "float", 1);
            mat.AddUniform("_ContactFoamEnabled", "float", 1);
            mat.AddUniform("_FoamHeightWeight", "float", 0.04);
            mat.AddUniform("_FoamSlopeWeight", "float", 0.08);
            mat.AddUniform("_FoamEdgeSoftness", "float", 0.16);
            mat.AddUniform("_FoamMaskScale", "float", 0.5);
            mat.AddUniform("_FoamMaskAspect", "float", 2.4);
            mat.AddUniform("_FoamMaskAngle", "float", -30);
            mat.AddUniform("_FoamBreakup", "float", 0.18);
            mat.AddUniform("_FoamDistortion", "float", 0.2);
            mat.AddUniform("_FoamSpeed", "vec2", new BABYLON.Vector2(0.2, 0.1));
            mat.AddUniform("_FoamFadeStart", "float", 480);
            mat.AddUniform("_FoamFadeEnd", "float", 1300);

            mat.AddUniform("_SSSColor", "vec3", new BABYLON.Vector3(0.1541919, 0.8857628, 0.990566));
            mat.AddUniform("_SSSStrength", "float", 0.15);
            mat.AddUniform("_SSSBase", "float", -0.261);
            mat.AddUniform("_SSSScale", "float", 4.7);

            mat.AddUniform("lightDirection", "vec3", "");
            mat.AddUniform("_WorldSpaceCameraPos", "vec3", "");
            mat.AddUniform("LengthScale0", "float", this._wavesGenerator.lengthScale[0]);
            mat.AddUniform("LengthScale1", "float", this._wavesGenerator.lengthScale[1]);
            mat.AddUniform("LengthScale2", "float", this._wavesGenerator.lengthScale[2]);
            mat.AddUniform("_Displacement_c0", "sampler2D", this._wavesGenerator.getCascade(0).displacement);
            mat.AddUniform("_Derivatives_c0", "sampler2D", this._wavesGenerator.getCascade(0).derivatives);
            mat.AddUniform("_Turbulence_c0", "sampler2D", this._wavesGenerator.getCascade(0).turbulence);
            mat.AddUniform("_Displacement_c1", "sampler2D", this._wavesGenerator.getCascade(1).displacement);
            mat.AddUniform("_Derivatives_c1", "sampler2D", this._wavesGenerator.getCascade(1).derivatives);
            mat.AddUniform("_Turbulence_c1", "sampler2D", this._wavesGenerator.getCascade(1).turbulence);
            mat.AddUniform("_Displacement_c2", "sampler2D", this._wavesGenerator.getCascade(2).displacement);
            mat.AddUniform("_Derivatives_c2", "sampler2D", this._wavesGenerator.getCascade(2).derivatives);
            mat.AddUniform("_Turbulence_c2", "sampler2D", this._wavesGenerator.getCascade(2).turbulence);
            mat.AddUniform("_Time", "float", 0);
            mat.AddUniform("_CameraDepthTexture", "sampler2D", this._depthRenderer.getDepthMap());
            mat.AddUniform("_CameraData", "vec4", new BABYLON.Vector4(this._camera.minZ, this._camera.maxZ, this._camera.maxZ - this._camera.minZ, 0));
            mat.AddUniform("_FoamTexture", "sampler2D", this._foamTexture);

            const cascades = [];
            if (useMid) {
                cascades.push("#define MID");
            }
            if (useClose) {
                cascades.push("#define CLOSE");
            }

            mat.Vertex_Definitions(`
                ${cascades.join("\n")}

                varying vec2 vWorldUV;
                varying vec2 vUVCoords_c0;
                varying vec2 vUVCoords_c1;
                varying vec2 vUVCoords_c2;
                varying vec3 vViewVector;
                varying vec4 vLodScales;
                varying vec4 vClipCoords;
                varying float vMetric;
                varying float vViewDistance;
                varying float vWaveHeight;
                varying vec3 vDisplacedWorldPosition;

                float oceanDistanceFade(float distanceValue, float fadeStart, float fadeEnd) {
                    float span = fadeEnd - fadeStart;
                    if (abs(span) < 0.00001) {
                        return distanceValue < fadeStart ? 1.0 : 0.0;
                    }
                    return clamp((fadeEnd - distanceValue) / span, 0.0, 1.0);
                }
            `);

            mat.Fragment_Definitions(`
                ${cascades.join("\n")}

                varying vec2 vWorldUV;
                varying vec2 vUVCoords_c0;
                varying vec2 vUVCoords_c1;
                varying vec2 vUVCoords_c2;
                varying vec3 vViewVector;
                varying vec4 vLodScales;
                varying vec4 vClipCoords;
                varying float vMetric;
                varying float vViewDistance;
                varying float vWaveHeight;
                varying vec3 vDisplacedWorldPosition;

                float oceanDistanceFade(float distanceValue, float fadeStart, float fadeEnd) {
                    float span = fadeEnd - fadeStart;
                    if (abs(span) < 0.00001) {
                        return distanceValue < fadeStart ? 1.0 : 0.0;
                    }
                    return clamp((fadeEnd - distanceValue) / span, 0.0, 1.0);
                }

                float oceanHash(vec2 value) {
                    return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
                }
            `);

            mat.Vertex_After_WorldPosComputed(`
                vWorldUV = worldPos.xz;
            
                vViewVector = _WorldSpaceCameraPos - worldPos.xyz;
                float viewDist = length(vViewVector);
                vViewDistance = viewDist;
            
                float lod_c0 = min(_LOD_scale * LengthScale0 / viewDist, 1.0);
                float lod_c1 = min(_LOD_scale * LengthScale1 / viewDist, 1.0);
                float lod_c2 = min(_LOD_scale * LengthScale2 / viewDist, 1.0);
                    
                vec3 displacement = vec3(0.);
                float largeWavesBias = 0.;
                float waveDistanceFade = oceanDistanceFade(viewDist, _WaveFadeStart, _WaveFadeEnd);
            
                vUVCoords_c0 = vWorldUV / LengthScale0;
                vUVCoords_c1 = vWorldUV / LengthScale1;
                vUVCoords_c2 = vWorldUV / LengthScale2;
            
                vec3 displacement0 = texture2D(_Displacement_c0, vUVCoords_c0).xyz;
                displacement += vec3(displacement0.x * _HorizontalScale0, displacement0.y * _VerticalScale0, displacement0.z * _HorizontalScale0) * lod_c0 * waveDistanceFade;
                largeWavesBias = displacement.y;
            
                #if defined(MID) || defined(CLOSE)
                    vec3 displacement1 = texture2D(_Displacement_c1, vUVCoords_c1).xyz;
                    displacement += vec3(displacement1.x * _HorizontalScale1, displacement1.y * _VerticalScale1, displacement1.z * _HorizontalScale1) * lod_c1 * waveDistanceFade;
                #endif
                #if defined(CLOSE)
                    vec3 displacement2 = texture2D(_Displacement_c2, vUVCoords_c2).xyz;
                    displacement += vec3(displacement2.x * _HorizontalScale2, displacement2.y * _VerticalScale2, displacement2.z * _HorizontalScale2) * lod_c2 * waveDistanceFade;
                #endif
    
                worldPos.xyz += displacement;
                vWaveHeight = displacement.y;
                vDisplacedWorldPosition = worldPos.xyz;

                vLodScales = vec4(lod_c0, lod_c1, lod_c2, max(displacement.y - largeWavesBias * 0.8 - _SSSBase, 0) / _SSSScale);
            `);

            mat.Vertex_MainEnd(`
                vClipCoords = gl_Position;
                vMetric = gl_Position.z;
            `);

            mat.Fragment_Before_Lights(`
                vec4 derivatives0 = texture2D(_Derivatives_c0, vUVCoords_c0);
                vec2 verticalDerivatives = derivatives0.xy * _VerticalScale0 * _NormalWeight0;
                vec2 horizontalDerivatives = derivatives0.zw * _HorizontalScale0 * _NormalWeight0;
                float foamSignal = (
                    -texture2D(_Turbulence_c0, vUVCoords_c0).x + _FoamBiasLOD0
                ) * _FoamWeight0;
                float normalDistanceFade = oceanDistanceFade(vViewDistance, _NormalFadeStart, _NormalFadeEnd);
                #if defined(MID) || defined(CLOSE)
                    vec4 derivatives1 = texture2D(_Derivatives_c1, vUVCoords_c1);
                    verticalDerivatives += derivatives1.xy * _VerticalScale1 * _NormalWeight1 * vLodScales.y * normalDistanceFade;
                    horizontalDerivatives += derivatives1.zw * _HorizontalScale1 * _NormalWeight1 * vLodScales.y * normalDistanceFade;
                    foamSignal += (
                        -texture2D(_Turbulence_c1, vUVCoords_c1).x + _FoamBiasLOD1
                    ) * _FoamWeight1;
                #endif
                #if defined(CLOSE)
                    vec4 derivatives2 = texture2D(_Derivatives_c2, vUVCoords_c2);
                    verticalDerivatives += derivatives2.xy * _VerticalScale2 * _NormalWeight2 * vLodScales.z * normalDistanceFade;
                    horizontalDerivatives += derivatives2.zw * _HorizontalScale2 * _NormalWeight2 * vLodScales.z * normalDistanceFade;
                    foamSignal += (
                        -texture2D(_Turbulence_c2, vUVCoords_c2).x + _FoamBiasLOD2
                    ) * _FoamWeight2;
                #endif

                vec2 slope = vec2(
                    verticalDerivatives.x / (1.0 + horizontalDerivatives.x),
                    verticalDerivatives.y / (1.0 + horizontalDerivatives.y)
                ) * _DetailNormalStrength;
                vec3 smoothWaveNormal = normalize(vec3(-slope.x * _NormalScaleX, 1.0, -slope.y * _NormalScaleZ));
                vec3 facetNormal = normalize(cross(dFdx(vDisplacedWorldPosition), dFdy(vDisplacedWorldPosition)));
                if (facetNormal.y < 0.0) facetNormal *= -1.0;
                float facetDistanceFade = oceanDistanceFade(vViewDistance, _FacetFadeStart, _FacetFadeEnd);
                float facetMix = _Stylized * _FacetStrength * facetDistanceFade;
                normalW = normalize(mix(smoothWaveNormal, facetNormal, facetMix));

                float slopeAmount = 1.0 - max(normalW.y, 0.0);
                float jacobian = saturate((
                    foamSignal +
                    vWaveHeight * _FoamHeightWeight +
                    slopeAmount * _FoamSlopeWeight
                ) * _FoamScale) * _CrestFoam;

                float foamAngle = radians(_FoamMaskAngle);
                mat2 foamRotation = mat2(cos(foamAngle), -sin(foamAngle), sin(foamAngle), cos(foamAngle));
                vec2 foamUV = foamRotation * (vWorldUV * vec2(_FoamMaskScale, _FoamMaskScale / _FoamMaskAspect));
                foamUV += _Time * _FoamSpeed;
                float foamNoise = oceanHash(floor(foamUV * 2.0));
                float foamPattern = texture2D(_FoamTexture, foamUV).r + (foamNoise - 0.5) * _FoamDistortion;
                float foamSoftness = max(_FoamEdgeSoftness, 0.0001);
                jacobian *= smoothstep(_FoamBreakup, _FoamBreakup + foamSoftness, foamPattern);
                jacobian *= oceanDistanceFade(vViewDistance, _FoamFadeStart, _FoamFadeEnd);

                vec2 screenUV = vClipCoords.xy / vClipCoords.w;
                screenUV = screenUV * 0.5 + 0.5;
                float backgroundDepth = texture2D(_CameraDepthTexture, screenUV).r * _CameraData.y;
                float surfaceDepth = vMetric;
                float depthDifference = max(0.0, (backgroundDepth - surfaceDepth) - 0.5);
                float contactPattern = texture2D(_FoamTexture, vWorldUV * 0.5 + _Time * 2.).r;
                jacobian += _ContactFoamEnabled * _ContactFoam * saturate(max(0.0, contactPattern - depthDifference) * 5.0) * 0.9;
                jacobian = saturate(jacobian);
    
                surfaceAlbedo = mix(vec3(0.0), _FoamColor, jacobian);

                vec3 viewDir = normalize(vViewVector);
                vec3 H = normalize(-normalW + lightDirection);
                float ViewDotH = pow5(saturate(dot(viewDir, -H))) * 30.0 * _SSSStrength;
                vec3 originalColor = mix(_Color, saturate(_Color + _SSSColor.rgb * ViewDotH * vLodScales.w), vLodScales.z);

                float heightMask = saturate(vWaveHeight * _HeightColorStrength + _HeightColorBias);
                float slopeMask = saturate(slopeAmount * _SlopeColorStrength + _SlopeColorBias);
                vec3 stylizedColor = mix(_ValleyColor, _Color, smoothstep(0.0, 0.58, heightMask));
                stylizedColor = mix(stylizedColor, _SlopeColor, slopeMask * (1.0 - heightMask));
                stylizedColor = mix(stylizedColor, _CrestColor, smoothstep(0.52, 1.0, heightMask));

                float lighting = saturate(dot(normalW, -normalize(lightDirection)) * 0.5 + 0.5);
                lighting = saturate(lighting * _ShadingContrast + _ShadingBias);
                float toneCount = max(_ToneSteps, 1.0);
                float steppedLighting = floor(lighting * toneCount + 0.5) / toneCount;
                lighting = mix(steppedLighting, lighting, saturate(_ToneTransition));
                stylizedColor *= 0.62 + lighting * 0.52;
                stylizedColor += _CrestColor * lighting * _LightColorStrength;

                vec2 patchCell = floor((vWorldUV + _Time * _PatchSpeed) / _PatchScale);
                float patchValue = oceanHash(patchCell) - 0.5;
                stylizedColor *= 1.0 + patchValue * _PatchStrength * _ColorPatches;
                float luminance = dot(stylizedColor, vec3(0.2126, 0.7152, 0.0722));
                stylizedColor = mix(vec3(luminance), stylizedColor, _Saturation) * _Brightness;

                vec3 reflectedLight = reflect(normalize(lightDirection), normalW);
                float highlight = pow(saturate(dot(reflectedLight, viewDir)), _HighlightSharpness);
                float glintAngle = radians(_GlintAngle);
                mat2 glintRotation = mat2(cos(glintAngle), -sin(glintAngle), sin(glintAngle), cos(glintAngle));
                vec2 glintUV = glintRotation * (vWorldUV * vec2(_GlintScale, _GlintScale / _GlintAspect));
                float glintPattern = sin(glintUV.x * 6.28318) * sin(glintUV.y * 6.28318);
                glintPattern += (oceanHash(floor(glintUV * 3.0)) - 0.5) * _GlintDistortion;
                float glint = highlight * smoothstep(_GlintThreshold, _GlintThreshold + 0.08, glintPattern);
                stylizedColor += _HighlightColor * glint * _HighlightStrength;

                vec3 color = mix(originalColor, stylizedColor, _Stylized);
    
                float fresnel = dot(normalW, viewDir);
                fresnel = saturate(1.0 - fresnel);
                fresnel = saturate(pow5(fresnel) * _FresnelStrength + _FresnelBias);
            `);

            mat.Fragment_Custom_MetallicRoughness(`
                float distanceGloss = mix(1.0 - metallicRoughness.g, _MaxGloss, 1.0 / (1.0 + length(vViewVector) * _RoughnessScale));
                metallicRoughness.g = 1.0 - mix(distanceGloss, 0.0, jacobian);
            `);

            mat.Fragment_Before_FinalColorComposition(`
                finalEmissive = mix(color * (1.0 - fresnel), vec3(0.0), jacobian);
            `);

            mat.Fragment_Before_FragColor(`
                //finalColor = vec4(toGammaSpace((normalW + vec3(1.)) / vec3(2.)), 1.);
                //finalColor = vec4(vec3(surfaceDepth), 1.);
            `);

            mat.onBindObservable.add(() => {
                const time = ((new Date().getTime() / 1000) - this._startTime) / 10;

                mat.getEffect()?.setVector3("_WorldSpaceCameraPos", this._camera.position);
                mat.getEffect()?.setTexture("_Turbulence_c0", this._wavesGenerator.getCascade(0).turbulence);
                mat.getEffect()?.setTexture("_Turbulence_c1", this._wavesGenerator.getCascade(1).turbulence);
                mat.getEffect()?.setTexture("_Turbulence_c2", this._wavesGenerator.getCascade(2).turbulence);
                mat.getEffect()?.setFloat("_Time", time);
                mat.getEffect()?.setVector3("lightDirection", (this._scene.lights[0] as BABYLON.DirectionalLight).direction);
            });

            return new Promise((resolve) => {
                if (this._foamTexture.isReady()) {
                    resolve(mat);
                } else {
                    this._foamTexture.onLoadObservable.addOnce(() => {
                        resolve(mat);
                    });
                }
            });
        } else {
            mat = await BABYLON.NodeMaterial.ParseFromSnippetAsync("R4152I#24", this._scene);

            mat.getInputBlockByPredicate((b) => b.name === "LOD_scale")!.value = 7.13;
            mat.getInputBlockByPredicate((b) => b.name === "LengthScale0")!.value = this._wavesGenerator.lengthScale[0];
            mat.getInputBlockByPredicate((b) => b.name === "Roughness")!.value = 0.311;
            mat.getInputBlockByPredicate((b) => b.name === "metallic")!.value = 0;
            (mat.getBlockByName("Displacement_c0") as BABYLON.TextureBlock).texture = this._wavesGenerator.getCascade(0).displacement as BABYLON.Texture;
            (mat.getBlockByName("Derivatives_c0") as BABYLON.TextureBlock).texture = this._wavesGenerator.getCascade(0).derivatives as BABYLON.Texture;

            //(mat.getBlockByName("PBRMetallicRoughness") as BABYLON.PBRMetallicRoughnessBlock).realTimeFiltering = true;

            mat.build();
        }

        return mat;
    }
}
