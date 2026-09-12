export const oceanWaveFunctions = /* glsl */ `
// 波分量表由 CPU 侧 buildWaveComponents 生成后整表传入，两边共用同一份定义，
// 避免"着色器改了、浮力用的 CPU 采样没改"导致船浮在错误高度。
#define WAVE_COUNT 24
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
`

export const oceanVertex = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
uniform mat4 world;
uniform float time;
uniform float cellSize;
uniform float facetJitter;
varying vec3 vWorld;
varying float vHeight;
varying vec3 vCrests;
varying vec2 vBase;
${oceanWaveFunctions}
void main() {
  vec2 base = position.xz;
  vec2 lattice = base / max(0.001, cellSize);
  // 只抖动渲染位置；base 保持规则格点，因此片元里 floor(vBase / cellSize)
  // 与真实面片逐一对应，面片 ID 不会错位。
  vec2 offset = (vec2(oceanHash(lattice), oceanHash(lattice + 37.13)) - 0.5) * facetJitter * cellSize;
  vec3 p = vec3(base.x + offset.x, position.y, base.y + offset.y);
  vec3 displacement; vec2 slope; vec3 crests;
  evaluateOcean(p.xz, displacement, slope, crests);
  p += displacement;
  vWorld = (world * vec4(p, 1.0)).xyz;
  vHeight = displacement.y;
  vCrests = crests;
  vBase = base;
  gl_Position = worldViewProjection * vec4(p, 1.0);
}`

export const oceanFragment = /* glsl */ `
#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec3 vWorld;
varying float vHeight;
varying vec3 vCrests;
varying vec2 vBase;
uniform vec3 cameraPosition;
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
uniform float cellSize;
uniform float facetStrength;
uniform float shadingContrast;
uniform float shadingBias;
uniform float toneSteps;
uniform float toneTransition;
uniform float heightColorStrength;
uniform float heightColorBias;
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

void main() {
  vec3 faceNormal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (faceNormal.y < 0.0) faceNormal *= -1.0;
  // 纯平色：只用真实三角形的面法线，不做平滑法线混合，也不叠加法线扰动。
  vec3 normal = faceNormal;
  float slope = 1.0 - max(normal.y, 0.0);
  // 面片 ID：把未变形的格点坐标量化成格号，逐面片得到稳定随机值。
  // 格号只取决于面片在地面网格里的位置，与浪高、时间无关，所以不会闪。
  // hash 必须与顶点着色器的 oceanHash、CPU 端 seaCellHash 保持同一公式。
  vec2 facetCell = floor(vBase / max(0.001, cellSize));
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
  water *= 1.0 + (facetId - .5) * facetStrength * .36;

  vec3 viewDir=normalize(cameraPosition-vWorld);
  // 昼夜色调与天空着色器用同一套判据，否则水面与天空的色温会对不上。
  // sunDirection 是光线传播方向，所以太阳高度是它的 -y。
  float sunElevation=-sunDirection.y;
  // 太阳沉到地平线以下后必须把暖色关掉，否则夜色会被染成紫红。
  float sunsetAmount=(1.0-smoothstep(.04,.24,sunElevation))*smoothstep(-.06,.02,sunElevation);
  float nightAmount=1.0-clamp((sunElevation+.08)/.28,0.0,1.0);
  // 夜里太阳在地平线以下，镜面高光会整体熄灭，所以入夜后改用月亮作为光路光源。
  vec3 lightToward=normalize(mix(-sunDirection,vec3(-.1,.22,.97),step(.5,nightAmount)));
  float ndv=max(dot(normal,viewDir),0.0);
  float fresnel=clamp((.025+.86*pow(1.0-ndv,4.0))*fresnelStrength+fresnelBias,0.0,1.0);
  // 天光反射随太阳高度变色：低太阳角时换成暖橙，入夜后压成冷蓝。
  vec3 reflectedSky=mix(
    mix(vec3(.50,.77,.91),vec3(1.0,.45,.18),sunsetAmount*.9),
    mix(vec3(.08,.38,.72),vec3(.34,.12,.30),sunsetAmount*.85),
    clamp(normal.y*.62+.22,0.0,1.0));
  reflectedSky=mix(reflectedSky,vec3(.04,.09,.19),nightAmount*.9);
  water=mix(water,reflectedSky,fresnel*(.42+roughness*.22));

  vec3 halfDir=normalize(viewDir+lightToward);
  float spec=pow(max(dot(normal,halfDir),0.0),max(2.0,highlightSharpness));
  // 碎金楔形带：太阳方位上才铺开反光，横向偏移越远越弱，越靠近观者越宽。
  // 参考图里这是一条从地平线太阳一路拉到近景的暖金色带，不是全屏均匀的闪烁。
  vec2 sunAz=normalize(lightToward.xz+vec2(1e-4,1e-4));
  vec2 rel=vWorld.xz-cameraPosition.xz;
  float along=dot(rel,sunAz);
  float lateral=abs(dot(rel,vec2(-sunAz.y,sunAz.x)));
  // 参考图的光路在屏幕上近似等宽，对应到世界空间就是随距离线性张开，
  // 而不是渐开到一个固定宽度（那样近景会整片糊满）。glintAspect 控制张角。
  float bandWidth=max(.5,along*(.04+glintScale*.16)*(1.0+glintAspect*.04));
  float wobble=1.0+(fbm(vWorld.xz*.06)-.5)*glintDistortion;
  float band=(1.0-smoothstep(bandWidth*.45,bandWidth*wobble,lateral))*smoothstep(-4.0,22.0,along);
  // 逐面片镜面：朝向太阳的面片整片一起亮，得到参考图的成片金色面片而不是点阵。
  float sparkle=step(glintThreshold,spec*(.45+hash(facetCell+7.3)*1.1)*band);
  float glint=sparkle*band;
  // 碎金是把水面"推向暖金色"，不是叠加一层白光——加法在这么大面积上会直接过曝成白斑。
  water=mix(water,highlightColor,clamp(glint*highlightStrength*.55,0.0,.8));
  // 普通高光也必须被楔形带门控：它的波瓣很宽，不门控会把暖色糊满整个下半屏，
  // 看起来像水里漂着大片米色斑块，而不是一条朝向太阳的光路。
  water+=highlightColor*spec*band*highlightStrength*.5;

  float foamSignal=max(
    vCrests.x*foamWeights.x-foamBias.x,
    max(vCrests.y*foamWeights.y-foamBias.y,vCrests.z*foamWeights.z-foamBias.z)
  );
  foamSignal+=vHeight*foamHeightWeight+slope*foamSlopeWeight;
  vec2 foamUV=rotation(radians(foamMaskAngle))*(vWorld.xz*vec2(foamMaskScale,foamMaskScale/max(.1,foamMaskAspect))+time*foamSpeed);
  float foamPattern=fbm(foamUV)+(noise(foamUV*2.7)-.5)*foamDistortion;
  // 低频噪声只负责把白沫打散成不连续的区域，形状本身交给面片量化。
  float organic=.58+.42*smoothstep(.34,.74,foamPattern);
  // 逐面片白沫：用面片 ID 扰动阈值，让白沫边界沿面片走，得到参考图的厚块感，
  // 而不是 fbm 那种细碎丝状噪声。
  float foamBand=foamSignal*(.8+hash(facetCell+19.7)*.4)*organic;
  float blocky=smoothstep(foamBreakup,foamBreakup+max(.02,foamEdgeSoftness),foamBand);
  // 碎晶白点：再用细一档的量化格撒小块，尺度由面片尺寸决定，远处不会糊成一片。
  vec2 shardCell=floor(vBase/max(.001,cellSize*.32));
  float shards=step(.9-hash(shardCell)*.26,max(foamSignal,0.0))*(.3+.7*step(.14,foamSignal));
  float foam=(blocky+shards*.4)*foamAmount*crestFoam;
  float dist=distance(cameraPosition,vWorld);
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
  water=mix(water,shallowColor,shallow*.85);
  // 岸线一圈白沫；step 用来避免岛屿内部（负距离）也长出白沫。
  float shoreFoam=(1.0-smoothstep(0.0,3.4,max(0.0,shoreDistance)))*step(-2.5,shoreDistance);
  water=mix(water,foamLit,clamp(contactFoam*foamContact*shoreFoam,0.0,.92));

  // 夕阳对水体本身的作用是"去饱和压暗"而不是加暖：实测参考图的黄昏水体是暗中性紫
  // （#584859，R≈B），暖色其实来自太阳光路与天光反射。之前朝亮暖色混合会把水洗成浅藕色。
  water=mix(water,vec3(.12,.09,.13),sunsetAmount*.7);
  // 入夜改为混向月光蓝，而不是乘暗：参考图的夜晚水面依然看得清。
  water=mix(water,vec3(.16,.26,.46),nightAmount*.55);

  float transmission=pow(max(0.0,dot(viewDir,-normalize(sunDirection))),3.0)*max(0.0,vHeight*sssScale+sssBase)*sssStrength;
  water+=sssColor*transmission*(1.0-foam);
  float lum=dot(water,vec3(.2126,.7152,.0722));
  water=mix(vec3(lum),water,saturation)*brightness;

  float fog=0.0;
  if(fogMode>.5&&fogMode<1.5) fog=smoothstep(fogStart,fogEnd,dist);
  else if(fogMode>=1.5) fog=1.0-exp(-dist*fogDensity*(fogMode>2.5?dist*fogDensity:1.0));
  water=mix(water,fogColor,clamp(fog,0.0,.92));
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
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.0,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+17.1;a*=.5;}return v;}
void main(){
 vec3 d=normalize(vPos);float y=clamp(d.y*.5+.5,0.0,1.0);
 float sunset=1.0-smoothstep(.04,.24,-sunDirection.y);
 vec3 horizon=mix(vec3(.50,.77,.91),vec3(1.0,.36,.10),sunset*.9);
 vec3 zenith=mix(vec3(.08,.38,.72),vec3(.52,.20,.28),sunset*.85);
 // 日落时把渐变指数压低，让暖色从地平线往上铺得更开，而不是很快转成灰紫。
 float gradPow=mix(.48,.7,clamp(turbidity/30.0,0.0,1.0))*(1.0-sunset*.4);
 vec3 sky=mix(horizon,zenith,pow(y,gradPow));
 // 地平线霞光必须叠加在夜景压暗之前：否则太阳落到地平线以下后霞光仍是全强度，
 // 夜里地平线会一直发橙，还会被水面的掠射反射带上岸。
 float haze=pow(1.0-max(d.y,0.0),5.0);sky=mix(sky,horizon,haze*.35);
 sky=mix(sky,vec3(.008,.025,.09),nightAmount*.94);
 float sun=pow(max(dot(d,normalize(-sunDirection)),0.0),4000.0);sky+=mix(vec3(1.0,.9,.65),vec3(1.0,.37,.12),sunset)*sun*2.8*(1.0-nightAmount);
 // 低太阳角时再补一圈很宽的暖辉：参考图的日落是整个天空在发光，不只是一颗小圆盘。
 float sunGlow=pow(max(dot(d,normalize(-sunDirection)),0.0),6.0);
 sky+=vec3(1.0,.44,.16)*sunGlow*sunset*.5*(1.0-nightAmount);
 if(d.y>.018){vec2 uv=d.xz/(d.y+.16)*.53;float cloud=smoothstep(.48,.67,fbm(uv+vec2(time*.003,0.0)));cloud*=smoothstep(.018,.11,d.y)*(1.0-smoothstep(.56,.94,d.y));vec3 cloudColor=mix(vec3(1.0,.94,.84),vec3(1.0,.54,.31),sunset*.65);sky=mix(sky,cloudColor,cloud*.82*(1.0-nightAmount*.72));}
 float stars=step(.985,hash(floor(d.xz*420.0/(d.y+.35))))*smoothstep(.12,.65,d.y)*nightAmount;
 sky+=vec3(.74,.86,1.0)*stars;
 sky*=mix(.72,1.28,clamp(rayleigh/4.0,0.0,1.0));sky+=vec3(1.0,.72,.42)*mie*sun*18.0;
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
