export const oceanWaveFunctions = /* glsl */ `
// 波分量表由 CPU 侧 buildWaveComponents 生成后整表传入，两边共用同一份定义，
// 避免"着色器改了、浮力用的 CPU 采样没改"导致船浮在错误高度。
#define WAVE_COUNT 24
#define FOAM_HISTORY 4
// time 由各顶点着色器自行声明（这里再声明会与之重复定义）
uniform float chop;
uniform vec4 waveA[WAVE_COUNT];   // x=方向x y=方向z z=波长 w=速度
uniform vec4 waveB[WAVE_COUNT];   // x=振幅 y=相位 z=水平挤压 w=所属波带
// 各波带总高度的均方根，用于把浪脊信号归一化成与分量数无关的统计量
uniform vec3 waveRms;

// 软饱和：把正弦压成平顶浪——顶部趋平、过渡段变陡，得到参考图的平台状浪尖。
// 返回 shaped 及其对相位的导数，保证坡度与高度严格一致。
void shapeWave(float phase, out float height, out float derivative) {
  float plateau = 1.4;
  float nrm = sqrt(1.0 + plateau * plateau);
  float s = sin(phase);
  float den = 1.0 + s * s * plateau * plateau;
  float rootDen = sqrt(den);
  height = s * nrm / rootDen;
  derivative = cos(phase) * nrm / (den * rootDen);
}

void evaluateOcean(vec2 base, out vec3 displacement, out vec2 slope, out vec3 crests) {
  displacement = vec3(0.0);
  slope = vec2(0.0);
  crests = vec3(0.0);
  vec3 bandHeight = vec3(0.0);
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 a = waveA[i];
    vec4 b = waveB[i];
    float k = 6.2831853 / max(a.z, 0.2);
    float phase = dot(base, a.xy) * k + time * a.w + b.y;
    float height, derivative;
    shapeWave(phase, height, derivative);
    float contribution = height * b.x;
    displacement.y += contribution;
    displacement.xz += a.xy * derivative * b.x * b.z * chop * 0.34;
    slope += a.xy * derivative * k * b.x;
    int band = int(b.w + 0.5);
    if (band == 0) bandHeight.x += contribution;
    else if (band == 1) bandHeight.y += contribution;
    else bandHeight.z += contribution;
  }
  // 浪脊强度用"该带总高度 / 该带均方根"衡量。
  // 不能再用「带内各分量取最大值」——分量越多，至少有一个接近浪尖的概率越高，
  // 8 个分量时会有 79% 的面积被判成浪脊（3 个分量时只有 44%），白沫会整片糊满。
  // 归一化后 hn 的标准差恒为 1，与分量数无关，白沫统计特性因此保持稳定。
  // 注意必须用有界映射：hn 理论上可到 ±4，若直接 pow(hn*0.5+0.5, 8) 会放大到上千。
  // 先线性映射进 [0,1] 再取 8 次幂：既保住旧版那种尖锐的浪尖读数，
  // 又不会像 pow(hn*0.5+0.5, 8) 那样在 hn 较大时放大到上千。
  vec3 hn = bandHeight / max(vec3(0.001), waveRms);
  crests = pow(clamp(hn * 0.3 + 0.5, 0.0, 1.0), vec3(8.0));
}

// 逐格稳定伪随机值：同样输入永远同样输出，用于面片 ID 与顶点抖动。
float oceanHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// 位移雅可比行列式：衡量水平位移把面片压缩到什么程度，J→0 表示面片接近折叠。
// 参考实现（Babylon FFT Ocean 官方 demo）正是用这个量驱动白沫，而不是高度极大值。
float evaluateJacobianAt(vec2 base, float t) {
  float jxx = 0.0, jzz = 0.0, jxz = 0.0;
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 a = waveA[i];
    vec4 b = waveB[i];
    float k = 6.2831853 / max(a.z, 0.2);
    float phase = dot(base, a.xy) * k + t * a.w + b.y;
    float s = sin(phase);
    float c = cos(phase);
    float p2 = 1.96;                       // plateau²，plateau = 1.4
    float den = 1.0 + s * s * p2;
    // shaped 的二阶导：-nrm · s · (den + 3p²c²) / den^2.5
    float d2 = -sqrt(1.0 + p2) * s * (den + 3.0 * p2 * c * c) / (den * den * sqrt(den));
    float qk = k * b.x * b.z * chop * 0.34;
    jxx += qk * a.x * a.x * d2;
    jzz += qk * a.y * a.y * d2;
    jxz += qk * a.x * a.y * d2;
  }
  return (1.0 + jxx) * (1.0 + jzz) - jxz * jxz;
}

// 时间累积的折叠度：在若干"过去时刻"上取衰减后的最小值。
// 这与参考实现的 turbulence = min(J, prev + dt·0.5/max(J,0.5)) 语义等价——
// min 让白沫在折叠瞬间立即出现，随时间的加法让它缓慢消散，白沫因此有"记忆"。
// 解析波场是时间的确定性函数，所以可以直接回采历史，不需要任何渲染目标。
uniform float foamHistoryStep;
float evaluateFoamFold(vec2 base) {
  float turbulence = 1.0;
  for (int k = 0; k < FOAM_HISTORY; k++) {
    float past = time - float(k) * foamHistoryStep;
    float jacobian = evaluateJacobianAt(base, past);
    turbulence = min(turbulence, jacobian + float(k) * foamHistoryStep * 0.5);
  }
  return turbulence;
}
`
export const skyShared = /* glsl */ `
// 天空基色：天空着色器与海面着色器**共用这一份实现**。
// 海天交界要严丝合缝，两边的颜色必须逐项一致——只调雾色是调不准的。
// 不含云与星空（那两项只在天空着色器里叠加）。
vec3 skyRadiance(vec3 d, float turbidity, float rayleigh, float mie, float nightAmount, float discContribution) {
  float sunset = 1.0 - smoothstep(.04, .24, -sunDirection.y);
  vec3 horizon = mix(vec3(.50,.77,.91), vec3(1.0,.36,.10), sunset*.9);
  vec3 zenith = mix(vec3(.08,.38,.72), vec3(.52,.20,.28), sunset*.85);
  float gradPow = mix(.48,.7, clamp(turbidity/30.0,0.0,1.0)) * (1.0 - sunset*.4);
  // 按**仰角**参数化，而不是 d.y*0.5+0.5。
  // 旧映射在地平线处给出 y=0.5 → pow(0.5,gradPow)≈0.68，也就是"地平线处已有 68% 是天顶色"，
  // 低空整片几乎均匀——那条亮而浅的地平线雾带根本没被画出来，海天相接自然显得生硬。
  // 新映射：地平线处 y=0 → 完全是地平线色；天顶处 y=1 → 完全是天顶色。
  vec3 sky = mix(horizon, zenith, pow(clamp(d.y,0.0,1.0), gradPow));
  float haze = pow(1.0 - max(d.y,0.0), 5.0);
  sky = mix(sky, horizon, haze*.35);
  sky = mix(sky, vec3(.008,.025,.09), nightAmount*.94);
  vec3 sunDir = normalize(-sunDirection);
  float sun = pow(max(dot(d, sunDir), 0.0), 4000.0)*discContribution;
  sky += mix(vec3(1.0,.9,.65), vec3(1.0,.37,.12), sunset)*sun*2.8*(1.0-nightAmount);
  float sunGlow = pow(max(dot(d, sunDir), 0.0), 6.0);
  sky += vec3(1.0,.44,.16)*sunGlow*sunset*.5*(1.0-nightAmount);
  sky *= mix(.72,1.28,clamp(rayleigh/4.0,0.0,1.0));
  sky += vec3(1.0,.72,.42)*mie*sun*18.0;
  return sky;
}
vec3 skyBaseColor(vec3 d, float turbidity, float rayleigh, float mie, float nightAmount) {
 return skyRadiance(d,turbidity,rayleigh,mie,nightAmount,1.0);
}
float skyNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);vec4 h=fract(sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1,0),vec2(127.1,311.7)),dot(i+vec2(0,1),vec2(127.1,311.7)),dot(i+vec2(1,1),vec2(127.1,311.7))))*43758.5453);return mix(mix(h.x,h.y,f.x),mix(h.z,h.w,f.x),f.y);}
float skyCloudNoise(vec2 p){float v=0.0,a=.5;for(int i=0;i<5;i++){v+=a*skyNoise(p);p=p*2.03+17.1;a*=.5;}return v;}
vec3 skyWithClouds(vec3 d,float turbidity,float rayleigh,float mie,float nightAmount,float t,float discContribution){
 vec3 color=skyRadiance(d,turbidity,rayleigh,mie,nightAmount,discContribution);
 if(d.y>.018){
  vec2 uv=d.xz/(d.y+.16)*.53;
  float cloud=smoothstep(.48,.67,skyCloudNoise(uv+vec2(t*.003,0)))*smoothstep(.018,.11,d.y)*(1.0-smoothstep(.56,.94,d.y));
  float sunset=1.0-smoothstep(.04,.24,-sunDirection.y);
  vec3 tint=mix(vec3(1,.94,.84),vec3(1,.54,.31),sunset*.65);
  color=mix(color,tint,cloud*.82*(1.0-nightAmount*.72));
 }
 return color;
}`

export const oceanVertex = /* glsl */ `
precision highp float;
attribute vec3 position;
// 每环一个面片边长，用顶点属性传入，避免为每个环复制一份材质。
attribute float ringCellSize;
uniform mat4 worldViewProjection;
uniform mat4 world;
uniform float time;
uniform float facetJitter;
uniform float heightScale;
varying vec3 vWorld;
varying float vHeight;
varying vec3 vCrests;
varying vec2 vBase;
varying float vFold;
varying float vFaceFold;
varying float vCellSize;
${oceanWaveFunctions}
void main() {
  vec2 base = position.xz;
  float cellSize = max(0.001, ringCellSize);
  vec2 lattice = base / cellSize;
  // 只抖动渲染位置；base 保持规则格点，因此片元里 floor(vBase / cellSize)
  // 与真实面片逐一对应，面片 ID 不会错位。
  vec2 offset = (vec2(oceanHash(lattice), oceanHash(lattice + 37.13)) - 0.5) * facetJitter * cellSize;
  vec3 p = vec3(base.x + offset.x, position.y, base.y + offset.y);
  vec3 displacement; vec2 slope; vec3 crests;
  evaluateOcean(p.xz, displacement, slope, crests);
  p += displacement;
  vWorld = (world * vec4(p, 1.0)).xyz;
  // 按默认设置的参考尺度归一化：拉浪高时只让波浪变大，配色/次表面/泡沫保持稳定。
  vHeight = displacement.y * heightScale;
  vCrests = crests;
  vBase = base;
  vCellSize = cellSize;
  // 面级折叠度：在**格心**求值，整格共用同一个数，高光选面时一个面才不会只亮一半。
  // 只用瞬时值——高光关心的是"这一格现在有没有浪花"，不需要泡沫那套衰减历史。
  vFaceFold = evaluateJacobianAt((floor(base / cellSize) + 0.5) * cellSize, time);
  // 折叠度在未变形的格点上求值：雅可比描述的是"平面 → 位移后曲面"这个映射的压缩程度。
  // 传入的是时间累积后的值（含衰减历史），白沫因此会残留。
  vFold = evaluateFoamFold(base);
  gl_Position = worldViewProjection * vec4(p, 1.0);
}`

export const oceanFragment = /* glsl */ `
#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec3 vWorld;
varying float vHeight;
varying vec3 vCrests;
varying vec2 vBase;
varying float vFold;
varying float vFaceFold;
varying float vCellSize;
uniform vec3 cameraPosition;
uniform sampler2D sceneReflection;
uniform mat4 reflectionMatrix;
uniform float seaLevel;
uniform vec2 reflectionTexel;
uniform vec3 moonDirection;
uniform float moonVisible;
uniform vec3 sunDirection;
uniform vec3 deepColor;
uniform vec3 midColor;
uniform vec3 slopeColor;
uniform vec3 crestColor;
uniform vec3 foamColor;
uniform vec3 highlightColor;
uniform vec3 sssColor;
uniform float shallowStart;
uniform float shallowEnd;
uniform vec3 shallowColor;
uniform vec3 islands[8];
uniform float islandCount;
uniform float contactFoam;
uniform float foamContact;
uniform vec3 fogColor;
uniform float time;
uniform float facetStrength;
uniform float edgeGlowStrength;
uniform float edgeGlowWidth;
uniform float vertexGlowStrength;
uniform float glowSpread;
uniform float shadowStrength;
uniform vec3 shipShadow;
uniform vec3 shipShadowSize;
uniform float shipYaw;
uniform float facetFadeStart;
uniform float facetFadeEnd;
uniform float shadingContrast;
uniform float shadingBias;
uniform float toneSteps;
uniform float toneTransition;
uniform float heightColorStrength;
uniform float heightColorBias;
uniform float slopeScale;
uniform float slopeColorStrength;
uniform float slopeColorBias;
uniform float lightColorStrength;
uniform float saturation;
uniform float brightness;
uniform float fresnelStrength;
uniform float fresnelBias;
uniform float roughness;
uniform float highlightStrength;
uniform float highlightSharpness;
uniform float glintScale;
uniform float glintAspect;
uniform float glintThreshold;
uniform float glintDistortion;
uniform float crestFoam;
uniform vec3 foamWeights;
uniform vec3 foamBias;
uniform float foamFoldBias;
uniform float foamFoldScale;
uniform float foamExtent;
uniform float skyLuminance;
uniform float turbidity;
uniform float rayleigh;
uniform float mie;
uniform float seaHalfExtent;
${skyShared}
uniform float foamAmount;
uniform float foamHeightWeight;
uniform float foamSlopeWeight;
uniform float foamEdgeSoftness;
uniform float foamMaskScale;
uniform float foamMaskAspect;
uniform float foamMaskAngle;
uniform float foamBreakup;
uniform float foamDistortion;
uniform vec2 foamSpeed;
uniform float foamFadeStart;
uniform float foamFadeEnd;
uniform float sssStrength;
uniform float sssBase;
uniform float sssScale;
uniform float fogMode;
uniform float fogStart;
uniform float fogEnd;
uniform float fogDensity;
uniform float stylized;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p) {
  float value=0.0, amplitude=.5;
  for(int i=0;i<4;i++){value+=noise(p)*amplitude;p=p*2.03+13.7;amplitude*=.5;}
  return value;
}
mat2 rotation(float angle){float c=cos(angle),s=sin(angle);return mat2(c,-s,s,c);}

// Analytic gradient of compact simplex kernels: irregular, continuous slopes,
// without the repeating interference pattern of a few fixed sine waves.
vec2 rippleCorner(vec2 offset,vec2 cell){
 float angle=hash(cell)*6.2831853;
 vec2 gradient=vec2(cos(angle),sin(angle));
 float support=max(.5-dot(offset,offset),0.0);
 float cube=support*support*support;
 return cube*support*gradient-8.0*cube*dot(gradient,offset)*offset;
}
vec2 rippleSlope(vec2 p){
 vec2 cell=floor(p+(p.x+p.y)*.366025404);
 vec2 a=p-cell+(cell.x+cell.y)*.211324865;
 vec2 corner=a.x>a.y?vec2(1,0):vec2(0,1);
 vec2 b=a-corner+.211324865;
 vec2 c=a-1.0+.422649731;
 return 70.0*(rippleCorner(a,cell)+rippleCorner(b,cell+corner)+rippleCorner(c,cell+1.0));
}

// The caller estimates filtering from first derivatives of world position only.
// N contains a derivative-built face normal: differentiating N again is undefined.
float waterSpecular(vec3 N,vec3 V,vec3 L,float alpha,float variance){
 float nv=max(dot(N,V),.001),nl=max(dot(N,L),0.0);
 vec3 H=normalize(V+L);
 float nh=max(dot(N,H),0.0),vh=max(dot(V,H),0.0);
 float a2=max(.001,alpha*alpha+variance);
 float denom=nh*nh*(a2-1.0)+1.0;
 float D=a2/(3.14159265*denom*denom);
 float gv=2.0*nv/(nv+sqrt(a2+(1.0-a2)*nv*nv));
 float gl=2.0*nl/max(.001,nl+sqrt(a2+(1.0-a2)*nl*nl));
 float F=.0204+.9796*pow(1.0-vh,5.0);
 return D*gv*gl*F/(4.0*nv);
}

void main() {
  vec3 faceNormal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (faceNormal.y < 0.0) faceNormal *= -1.0;
  // 纯平色：只用真实三角形的面法线，不做平滑法线混合，也不叠加法线扰动。
  vec3 normal = faceNormal;
  // 同 vHeight：坡度也按参考尺度归一化，否则拉浪高时坡色也会饱和。
  float slope = (1.0 - max(normal.y, 0.0)) * slopeScale;
  // 面片 ID：把未变形的格点坐标量化成格号，逐面片得到稳定随机值。
  // 格号只取决于面片在地面网格里的位置，与浪高、时间无关，所以不会闪。
  // hash 必须与顶点着色器的 oceanHash、CPU 端 seaCellHash 保持同一公式。
  vec2 facetCell = floor(vBase / max(0.001, vCellSize));
  float facetId = hash(facetCell);

  float heightMask = clamp(vHeight*heightColorStrength+heightColorBias,0.0,1.0);
  float slopeMask = clamp(slope*slopeColorStrength+slopeColorBias,0.0,1.0);
  vec3 water = mix(deepColor,midColor,smoothstep(.08,.68,heightMask));
  water = mix(water,slopeColor,slopeMask*(1.0-heightMask*.45));
  water = mix(water,crestColor,smoothstep(.58,.98,heightMask)*.82);

  float lighting = clamp(dot(normal,normalize(-sunDirection))*.52+.52,0.0,1.0);
  lighting = clamp(lighting*shadingContrast+shadingBias,0.0,1.0);
  float stepped = floor(lighting*max(1.0,toneSteps)+.5)/max(1.0,toneSteps);
  // 风格化色阶开启时用硬档位，关闭时退回连续明暗。
  lighting = mix(stepped, lighting, mix(1.0, clamp(toneTransition,0.0,1.0), step(0.5, stylized)));
  water *= .55+lighting*.64;
  water += crestColor*lighting*lightColorStrength;

  // 逐面片明度差异：相邻面片明度跳变，是低多边形面片读感的主要来源。
  // 面片效果按距离淡出：远处面片在屏幕上只有几像素，逐面片抖分会变成噪点。
  float facetViewDistance = distance(cameraPosition, vWorld);
  float facetFade = 1.0 - smoothstep(facetFadeStart, max(facetFadeStart + 1.0, facetFadeEnd), facetViewDistance);
  water *= 1.0 + (facetId - .5) * facetStrength * .36 * facetFade;

  // ---- 棱边与顶点高光（风格化点缀）----
  // 不需要额外几何或顶点属性：三角化方式是已知的——每格是"两条格边 + 一条对角线"，
  // 对角线方向由格号哈希决定（与 CPU 建网格时的 seaCellHash 同式同格号）。
  vec2 cellScale = vBase / max(0.001, vCellSize);
  vec2 cellUV = fract(cellScale);
  vec2 cellIdx = cellScale - cellUV;
  float diagFlip = hash(cellIdx);
  float dAxis = min(min(cellUV.x, 1.0 - cellUV.x), min(cellUV.y, 1.0 - cellUV.y));
  float dDiag = (diagFlip > 0.5 ? abs(cellUV.x - cellUV.y) : abs(cellUV.x + cellUV.y - 1.0)) * 0.7071;
  float triEdge = 1.0 - smoothstep(0.0, max(0.002, edgeGlowWidth), min(dAxis, dDiag));
  // 选面：**有浪花的面才亮**，不是随机抽面。
  // 用面级折叠度（整格一个值）算泡沫信号，与可见白沫同一套公式，所以高光一定贴着浪花。
  // 注意信号是**有符号**的：>0 在浪花里、<0 在浪花外，扩散量就是向外走的距离。
  float faceFoamSignal = (foamFoldBias - vFaceFold) * foamFoldScale;
  // 由浪花向外扩散：浪花内为满值，出了浪花按扩散量羽化衰减。
  float glowMask = clamp(faceFoamSignal + glowSpread, 0.0, 1.0)
                 * exp(-max(-faceFoamSignal, 0.0) / max(0.05, glowSpread * 2.5));
  // 顶点：取格子四角，整格共用
  float cornerProx = 1.0 - smoothstep(0.0, max(0.004, edgeGlowWidth * 2.4), length(min(cellUV, 1.0 - cellUV)));
  float glow = triEdge * edgeGlowStrength + cornerProx * vertexGlowStrength;
  // 远处面片只有几像素，跟着 facetFade 一起淡出，避免变成噪点
  water += mix(crestColor, vec3(0.72, 0.94, 1.0), 0.6) * glow * glowMask * facetFade;

  vec3 viewDir=normalize(cameraPosition-vWorld);
  // 昼夜色调与天空着色器用同一套判据，否则水面与天空的色温会对不上。
  // sunDirection 是光线传播方向，所以太阳高度是它的 -y。
  float sunElevation=-sunDirection.y;
  // 太阳沉到地平线以下后必须把暖色关掉，否则夜色会被染成紫红。
  float sunsetAmount=(1.0-smoothstep(.04,.24,sunElevation))*smoothstep(-.06,.02,sunElevation);
  float nightAmount=1.0-clamp((sunElevation+.08)/.28,0.0,1.0);
  // 水体自身的昼夜染色必须放在反射**之前**：它描述的是"水本身"的颜色，
  // 放在反射之后会把刚混进去的天光反射整个盖掉——这正是之前"看不到倒影"的原因。
  // 夕阳对水体本身的作用是"去饱和压暗"而不是加暖：实测参考图的黄昏水体是暗中性紫
  // （#584859，R≈B），暖色其实来自太阳光路与天光反射。之前朝亮暖色混合会把水洗成浅藕色。
  water=mix(water,vec3(.12,.09,.13),sunsetAmount*.7);
  // 入夜改为混向月光蓝，而不是乘暗：参考图的夜晚水面依然看得清。
  water=mix(water,vec3(.16,.26,.46),nightAmount*.55);

  // Let real wave faces lead. Two rotated, elongated slope fields only break edges.
  // 碎金的**空间频率**。原来的 .10+glintScale*.22 最高只到 0.32（特征 3.1 m），
  // 而面片本身是 3~12 m——两者同一量级，所以涟漪只能形成大尺度平滑起伏，
  // 画面就是"宽而软的棉絮带"，而不是细碎闪光。面板当时根本够不到有用区间。
  // 现在覆盖 0.20~2.65（特征 5 m~0.38 m），远处仍由下面的足迹过滤防走样。
  float frequency=.15+glintScale*2.5;
  vec2 pixelDx=dFdx(vWorld.xz),pixelDy=dFdy(vWorld.xz);
  float footprint=max(length(pixelDx),length(pixelDy));
  float resolved=1.0-smoothstep(.18,.85,footprint*frequency);
  float fineResolved=1.0-smoothstep(.18,.85,footprint*frequency*2.13);
  vec2 drift=vWorld.xz+vec2(time*.31,-time*.23);
  vec2 p=rotation(.43)*drift*frequency;
  vec2 coarse=rippleSlope(p*vec2(1.0,.43))*vec2(1.0,.43);
  vec2 fine=rippleSlope(rotation(1.17)*p*2.13+vec2(31.7,8.3));
  vec2 ripple=rotation(-.43)*(coarse*resolved+rotation(-1.17)*fine*.23*fineResolved);
  float detailAmplitude=.012+glintDistortion*.018;
  vec3 reflectionNormal=normalize(mix(vec3(0,1,0),normal,.85)+
    vec3(ripple.x,0.0,ripple.y)*detailAmplitude);
  float specularVariance=.002*(1.0-resolved)+.0015*smoothstep(.4,1.8,footprint/max(.001,vCellSize));
  float ndv=max(dot(reflectionNormal,viewDir),0.0);
  float fresnel=clamp((.0204+.9796*pow(1.0-ndv,5.0))*fresnelStrength+fresnelBias,0.0,1.0);
  vec3 reflectDir=reflect(-viewDir,reflectionNormal);
  vec3 reflectedSky=pow(clamp(skyWithClouds(reflectDir,turbidity,rayleigh,mie,nightAmount,time,0.0)*skyLuminance,0.0,1.0),vec3(.92));
  // Project the mean water plane into the mirrored camera, then perturb within a bounded footprint.
  vec4 projected=reflectionMatrix*vec4(vWorld.x,seaLevel,vWorld.z,1.0);
  vec2 reflectionUV=projected.xy/max(.001,projected.w)*.5+.5;
  vec2 perturb=reflectionNormal.xz*(.008+roughness*.012)/(1.0+facetViewDistance*.006);
  reflectionUV+=vec2(perturb.x,-perturb.y);
  vec2 blur=reflectionTexel*(.6+roughness*5.0);
  vec2 safeUV=clamp(reflectionUV,blur*2.0,vec2(1.0)-blur*2.0);
  vec4 reflected=texture2D(sceneReflection,safeUV)*.4;
  reflected+=texture2D(sceneReflection,safeUV+vec2(blur.x,0))*.15;
  reflected+=texture2D(sceneReflection,safeUV-vec2(blur.x,0))*.15;
  reflected+=texture2D(sceneReflection,safeUV+vec2(0,blur.y))*.15;
  reflected+=texture2D(sceneReflection,safeUV-vec2(0,blur.y))*.15;
  float screenEdge=min(min(reflectionUV.x,1.0-reflectionUV.x),min(reflectionUV.y,1.0-reflectionUV.y));
  float valid=smoothstep(.0,.035,screenEdge)*step(.001,projected.w);
  vec3 environment=reflectedSky*(1.0-reflected.a*valid)+reflected.rgb*valid;
  water=mix(water,environment,fresnel*(1.0-roughness*.25));

  float alpha=clamp(sqrt(2.0/(highlightSharpness+2.0))*(.65+roughness),.055,.5);
  float sunVisible=smoothstep(-.025,.06,sunElevation);
  // 月亮的可见度由 CPU 统一给出：圆盘与水面光路必须用**同一个**门控，
  // 否则会出现"天上没有月亮、水里却有月亮光路"——两条光路一个天体，看着就是两个太阳。
  // 原来这里用 smoothstep(.2,.95,nightAmount)，黄昏时已有 0.115，月亮光路提前出现。
  float sunSpec=waterSpecular(reflectionNormal,viewDir,normalize(-sunDirection),alpha,specularVariance);
  float moonSpec=waterSpecular(reflectionNormal,viewDir,normalize(moonDirection),alpha*.75,specularVariance);
  float response=exp2(-glintThreshold*1.5);
  vec3 sunTint=mix(highlightColor,vec3(1.0,.50,.18),sunsetAmount*.6);
  vec3 moonTint=vec3(.82,.90,1.0);
  vec3 radiance=sunTint*sunSpec*sunVisible*12.0+moonTint*moonSpec*moonVisible*6.0;
  // Soft photographic shoulder, instead of a binary gold-colour mask.
  radiance*=highlightStrength*response;
  water+=radiance/(1.0+max(radiance.r,max(radiance.g,radiance.b)))*.9;
  // ---- 白沫主项：位移雅可比（折叠度）----
  // 参考实现用的是同一判据，只是它把折叠度写进一张持久纹理做时间累积；
  // 这里先用瞬时值，等缓冲链路打通再加上衰减，白沫就会带上"记忆"。
  float foldFoam=clamp((foamFoldBias-vFold)*foamFoldScale,0.0,1.0);
  // 浪高与坡度只做细修正（参考实现里它们的权重也只有 0.04 / 0.08）
  float refine=max(
    vCrests.x*foamWeights.x-foamBias.x,
    max(vCrests.y*foamWeights.y-foamBias.y,vCrests.z*foamWeights.z-foamBias.z)
  );
  refine+=vHeight*foamHeightWeight+slope*foamSlopeWeight;
  float foamSignal=max(0.0,foldFoam+max(0.0,refine)*.6);
  vec2 foamUV=rotation(radians(foamMaskAngle))*(vWorld.xz*vec2(foamMaskScale,foamMaskScale/max(.1,foamMaskAspect))+time*foamSpeed);
  float foamPattern=fbm(foamUV)+(noise(foamUV*2.7)-.5)*foamDistortion;
  // 低频噪声只负责把白沫打散成不连续的区域，形状本身交给面片量化。
  float organic=.58+.42*smoothstep(.34,.74,foamPattern);
  // 逐面片白沫：用面片 ID 扰动阈值，让白沫边界沿面片走，得到参考图的厚块感，
  // 而不是 fbm 那种细碎丝状噪声。
  float foamBand=foamSignal*(.8+hash(facetCell+19.7)*.4)*organic;
  float blocky=smoothstep(foamBreakup,foamBreakup+max(.02,foamEdgeSoftness),foamBand);
  // 碎晶白点：再用细一档的量化格撒小块，尺度由面片尺寸决定，远处不会糊成一片。
  vec2 shardCell=floor(vBase/max(.001,vCellSize*.32));
  float shards=step(.9-hash(shardCell)*.26,max(foamSignal,0.0))*(.3+.7*step(.14,foamSignal));
  float foam=(blocky+shards*.4)*foamAmount*crestFoam;
  float dist=facetViewDistance;
  foam*=1.0-smoothstep(foamFadeStart,foamFadeEnd,dist);
  // 白沫是自发的漫反射白体：受光面趋近纯白，背光面只是略冷略暗。
  // 不能像水面那样按面法线压暗，否则倾斜浪脊上的白沫会变成土黄色块。
  vec3 foamLit=mix(foamColor,vec3(1.0),.75);
  vec3 foamShade=mix(foamColor,slopeColor,.3)*.85;
  vec3 foamTint=mix(foamShade,foamLit,.35+.65*lighting);
  water=mix(water,foamTint,clamp(foam,0.0,.96));

  // 近岸浅水与接触白沫：用一组「岛屿圆心 + 半径」在片元里算到最近岸线的距离场，
  // 不需要深度图或额外渲染目标，代价只是一个 8 次循环。
  float shoreDistance=1.0e5;
  for(int i=0;i<8;i++){
    if(float(i)>=islandCount) break;
    vec3 island=islands[i];
    shoreDistance=min(shoreDistance,distance(vWorld.xz,island.xy)-island.z);
  }
  // 越靠近岸线越浅，向薄荷青绿过渡；参考图的近岸瓦片明显更亮更绿。
  float shallow=1.0-smoothstep(shallowStart,max(shallowStart+1.0,shallowEnd),max(0.0,shoreDistance));
  // ---- 阴影（解析式）----
  // 海面是自定义 ShaderMaterial，拿不到 Babylon 的阴影贴图：试过在片元里手动采样，
  // 但深度编码对不上（实测 87% 的像素被判成阴影），不再靠猜。
  // 改为对我们的简单几何直接求交：从水面沿太阳方向反推到物体高度，看落点是否在底面内。
  // 岛 = 圆柱，船 = 长方体。确定、无编码依赖、开销只有几次距离判断。
  float shadowFactor = 1.0;
  vec3 toSun = normalize(-sunDirection);
  if (shadowStrength > 0.001 && toSun.y > 0.02) {
    vec2 sunStep = toSun.xz / toSun.y;
    for (int i = 0; i < 8; i++) {
      if (float(i) >= islandCount) break;
      vec3 island = islands[i];
      float radius = island.z;
      if (radius <= 0.0) continue;
      float height = max(1.0, radius * 1.15);      // 岛高与岸半径同量级
      vec2 hit = vWorld.xz + sunStep * max(0.0, height - vWorld.y);
      if (distance(hit, island.xy) < radius) shadowFactor = 0.0;
    }
    // 船：转到船的局部坐标系再测长方体
    if (shipShadow.y > 0.0) {
      float height = shipShadow.z;
      vec2 hit = vWorld.xz + sunStep * max(0.0, height - vWorld.y);
      vec2 rel = hit - shipShadow.xy;
      float s = sin(shipYaw), c = cos(shipYaw);
      vec2 local = vec2(rel.x * c + rel.y * s, -rel.x * s + rel.y * c);
      if (abs(local.x) < shipShadowSize.x && abs(local.y) < shipShadowSize.y) shadowFactor = 0.0;
    }
  }

  water=mix(water,shallowColor,shallow*.85);
  // 阴影作用在**水体本身**：在浅水混合之后、白沫与高光之前。
  // 白沫是散射出来的亮部，不该被太阳阴影直接压掉。
  water=mix(water,water*.42,1.0-shadowFactor);
  // 岸线一圈白沫；step 用来避免岛屿内部（负距离）也长出白沫。
  float shoreFoam=(1.0-smoothstep(0.0,3.4,max(0.0,shoreDistance)))*step(-2.5,shoreDistance);
  water=mix(water,foamLit,clamp(contactFoam*foamContact*shoreFoam,0.0,.92));


  // 次表面透射只应发生在**逆光**时（相机朝太阳看，光从浪脊背后透过来）。
  // 原来用的是 dot(viewDir, 指向太阳)：这个量在"太阳在相机这一侧、水面正面受光"时最大，
  // 恰好是最不该有透射的情况——符号反了。结果是从某些朝向俯瞰时整片水面被涂成 sssColor
  // （亮青），而且只在特定朝向出现。
  float backlight = max(0.0, -dot(viewDir, -normalize(sunDirection)));
  float transmission=pow(backlight,3.0)*max(0.0,vHeight*sssScale+sssBase)*sssStrength;
  water+=sssColor*transmission*(1.0-foam);
  float lum=dot(water,vec3(.2126,.7152,.0722));
  water=mix(vec3(lum),water,saturation)*brightness;

  float fog=0.0;
  if(fogMode>.5&&fogMode<1.5) fog=smoothstep(fogStart,fogEnd,dist);
  else if(fogMode>=1.5) fog=1.0-exp(-dist*fogDensity*(fogMode>2.5?dist*fogDensity:1.0));
  water=mix(water,fogColor,clamp(fog,0.0,.92));

  // ---- 海天交界：把远处水面融进天空的地平线颜色 ----
  // 只调雾色是不够的：雾在平面边缘也到不了 100%，而且雾色与天空地平线色本来就不同，
  // 结果就是一条硬边。这里用与天空着色器**完全相同**的公式算出地平线色，
  // 再按"视线是否接近水平"把它混上去，接缝因此彻底消失，且与海面尺寸无关。
  // 用与天空着色器**完全相同**的共享实现 skyBaseColor 算地平线方向上的天空色。
  // 手写近似会漏掉三样东西：d.y=0 处的天顶渐变、地平线霞光项、以及 rayleigh 缩放——
  // 结果偏亮，两边对不上就是那条接缝。
  vec3 horizonDir=normalize(vec3(viewDir.x,0.0,viewDir.z)+vec3(1e-5,0.0,1e-5));
  vec3 horizonColor=pow(clamp(skyBaseColor(horizonDir,turbidity,rayleigh,mie,nightAmount)*skyLuminance,0.0,1.0),vec3(.92));
  // 渐隐范围跟着"到海面平面边界的距离"自适应：
  // 在到达边界之前就把水面完全变成天空色，这样平面边缘本身落在已经虚化完的区域里，
  // 接缝因此不可见——而且相机升高、朝向改变时都成立（固定的 viewDir 阈值做不到这点）。
  vec2 planar = vWorld.xz - cameraPosition.xz;
  vec2 planarDir = planar / max(1e-4, length(planar));
  // 注意不能用 sign(planarDir)：分量为 0 时 sign 返回 0，会算出 0/0 = NaN 让整个混合失效。
  vec2 dirSign = vec2(planarDir.x >= 0.0 ? 1.0 : -1.0, planarDir.y >= 0.0 ? 1.0 : -1.0);
  vec2 edgeT = (dirSign * seaHalfExtent - cameraPosition.xz) / planarDir;
  float edgeDistance = max(1.0, min(edgeT.x, edgeT.y));
  float horizonFade = smoothstep(edgeDistance * 0.35, edgeDistance * 0.88, dist);
  water = mix(water, horizonColor, horizonFade);

  gl_FragColor=vec4(water,1.0);
}`

export const skyVertex = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vPos;
void main(){vPos=position;gl_Position=worldViewProjection*vec4(position,1.0);}
`

export const skyFragment = /* glsl */ `
precision highp float;
varying vec3 vPos;
uniform float time;
uniform vec3 sunDirection;
uniform float luminance;
uniform float turbidity;
uniform float rayleigh;
uniform float mie;
uniform float nightAmount;
${skyShared}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.0,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+17.1;a*=.5;}return v;}
void main(){
 vec3 d=normalize(vPos);
 float sunset=1.0-smoothstep(.04,.24,-sunDirection.y);
 // 天空基色与海面共用同一份实现，海天交界才能对齐
 vec3 sky=skyWithClouds(d,turbidity,rayleigh,mie,nightAmount,time,1.0);
 float stars=step(.985,hash(floor(d.xz*420.0/(d.y+.35))))*smoothstep(.12,.65,d.y)*nightAmount;
 sky+=vec3(.74,.86,1.0)*stars;
 gl_FragColor=vec4(pow(clamp(sky*luminance,0.0,1.0),vec3(.92)),1.0);
}`

export const wakeVertex = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
uniform mat4 world;
uniform float time;
uniform float waterOffset;
varying vec3 vWorld;
varying vec3 vCrests;
${oceanWaveFunctions}
void main(){vec3 p=position;vec3 displacement;vec2 slope;vec3 crests;evaluateOcean(p.xz,displacement,slope,crests);p.y+=displacement.y+waterOffset;vWorld=(world*vec4(p,1.0)).xyz;vCrests=crests;gl_Position=worldViewProjection*vec4(p,1.0);}
`

export const wakeFragment = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vCrests;
uniform float time;
uniform float originZ;
uniform float wakeLength;
uniform float initialWidth;
uniform float spread;
uniform float angle;
uniform float breakup;
uniform float textureScale;
uniform float brightness;
uniform float cellSize;
uniform float gridOffset;
uniform vec3 wakeColor;
uniform vec3 wakeWaterColor;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){
 float distanceBehind=originZ-vWorld.z;
 float t=distanceBehind/max(1.0,wakeLength);
 if(t<0.0||t>1.0)discard;
 // V 形双臂：随距离线性张开
 float armWidth=initialWidth+distanceBehind*tan(radians(angle)*.5)*spread;
 float edgeDistance=abs(abs(vWorld.x)-armWidth);
 float n=noise(vWorld.xz*textureScale+vec2(time*.12,-time*.26));
 // 手臂要有厚度：参考图的尾迹是一条粗白带，细线会读成"绳子"。
 // 噪声门控要宽：太窄会让双臂碎成一串孤岛，参考图的手臂是连续白带带碎边。
 float edge=smoothstep(2.6,.05,edgeDistance)*smoothstep(breakup-.26,breakup+.14,n);
 // 船正后方的湍流核心，随距离迅速消散
 float center=smoothstep(initialWidth*2.2,0.0,abs(vWorld.x))*smoothstep(.4,0.0,t)*smoothstep(breakup-.2,breakup+.22,noise(vWorld.xz*textureScale*1.8-time*.2));
 float foamDrive=edge+center*.85;
 // 与海面共用同一套面片格：尾迹泡沫按海面面片整片出现，才能和浪脊白沫咬合成参考图那样的碎块，
 // 而不是叠出一条平滑的白色带子（旧实现画出来像两根绳子）。
 vec2 oceanCell=floor((vWorld.xz+vec2(gridOffset))/max(.001,cellSize));
 float facetId=hash(oceanCell+41.3);
 // 阈值要够高：太低会让整条轨迹连成一片均匀乳白膜，失去参考图那种高对比碎块。
 float chunk=step(breakup*.85,foamDrive*(.45+facetId*.95));
 // 浪脊上的尾迹泡沫更厚，与海面白沫融为一体
 float crestBoost=max(vCrests.x,max(vCrests.y,vCrests.z))*.35*edge;
 float fade=1.0-smoothstep(.42,1.0,t);
 float alpha=clamp((foamDrive*chunk*1.9+crestBoost)*fade,0.0,.96);
 float thickness=clamp(foamDrive*chunk*1.6,0.0,1.0);
 vec3 color=mix(wakeWaterColor,wakeColor,thickness)*brightness;
 gl_FragColor=vec4(color,alpha);
}`
