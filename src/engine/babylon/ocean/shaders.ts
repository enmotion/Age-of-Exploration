export const oceanWaveFunctions = /* glsl */ `
uniform vec2 waveDirection0;
uniform vec2 waveDirection1;
uniform vec2 waveDirection2;
uniform vec3 waveLength;
uniform vec3 waveAmplitude;
uniform vec3 waveSpeed;
uniform vec3 horizontalScale;
uniform float chop;

void addOceanWave(vec2 base, vec2 direction, float length, float speed, float amplitude, float horizontal, float phaseOffset, inout vec3 displacement, inout vec2 slope, inout float crest) {
  float k = 6.2831853 / max(length, 0.2);
  float phase = dot(base, direction) * k + time * speed + phaseOffset;
  float waveHeight = sin(phase) * amplitude;
  displacement.y += waveHeight;
  displacement.xz += direction * cos(phase) * amplitude * horizontal * chop * 0.34;
  slope += direction * cos(phase) * k * amplitude;
  crest = max(crest, pow(max(0.0, sin(phase) * 0.5 + 0.5), 8.0));
}

void evaluateOcean(vec2 base, out vec3 displacement, out vec2 slope, out vec3 crests) {
  displacement = vec3(0.0);
  slope = vec2(0.0);
  crests = vec3(0.0);
  vec2 directions[3];
  directions[0] = normalize(waveDirection0);
  directions[1] = normalize(waveDirection1);
  directions[2] = normalize(waveDirection2);
  for (int i = 0; i < 3; i++) {
    vec2 d = directions[i];
    vec2 d1 = normalize(vec2(d.x*.82-d.y*.57,d.x*.57+d.y*.82));
    vec2 d2 = normalize(vec2(d.x*.91+d.y*.41,-d.x*.41+d.y*.91));
    float crest = 0.0;
    addOceanWave(base,d,waveLength[i],waveSpeed[i],waveAmplitude[i]*.72,horizontalScale[i],float(i)*1.73,displacement,slope,crest);
    addOceanWave(base,d1,waveLength[i]*.64,waveSpeed[i]*1.34,waveAmplitude[i]*.2,horizontalScale[i]*.8,float(i)*2.31+2.2,displacement,slope,crest);
    addOceanWave(base,d2,waveLength[i]*.41,waveSpeed[i]*1.77,waveAmplitude[i]*.1,horizontalScale[i]*.62,float(i)*3.17-1.4,displacement,slope,crest);
    crests[i] = crest;
  }
}
`

export const oceanVertex = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
uniform mat4 world;
uniform float time;
varying vec3 vWorld;
varying float vHeight;
varying vec3 vCrests;
varying vec3 vSmoothNormal;
${oceanWaveFunctions}
void main() {
  vec3 p = position;
  vec3 displacement; vec2 slope; vec3 crests;
  evaluateOcean(p.xz, displacement, slope, crests);
  p += displacement;
  vWorld = (world * vec4(p, 1.0)).xyz;
  vHeight = displacement.y;
  vCrests = crests;
  vSmoothNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
  gl_Position = worldViewProjection * vec4(p, 1.0);
}`

export const oceanFragment = /* glsl */ `
#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec3 vWorld;
varying float vHeight;
varying vec3 vCrests;
varying vec3 vSmoothNormal;
uniform vec3 cameraPosition;
uniform vec3 sunDirection;
uniform vec3 deepColor;
uniform vec3 midColor;
uniform vec3 slopeColor;
uniform vec3 crestColor;
uniform vec3 foamColor;
uniform vec3 highlightColor;
uniform vec3 sssColor;
uniform vec3 fogColor;
uniform float time;
uniform float facetStrength;
uniform float detailNormalStrength;
uniform float normalScaleX;
uniform float normalScaleZ;
uniform float shadingContrast;
uniform float shadingBias;
uniform float toneSteps;
uniform float toneTransition;
uniform float colorPatches;
uniform float patchScale;
uniform float patchStrength;
uniform vec2 patchSpeed;
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
uniform float glintAngle;
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
  vec3 smoothNormal = normalize(vec3(vSmoothNormal.x*normalScaleX, vSmoothNormal.y, vSmoothNormal.z*normalScaleZ));
  vec3 normal = normalize(mix(smoothNormal, faceNormal, clamp(facetStrength*stylized,0.0,1.0)));
  normal = normalize(mix(vec3(0.0,1.0,0.0),normal,detailNormalStrength));
  float slope = 1.0 - max(normal.y,0.0);

  float heightMask = clamp(vHeight*heightColorStrength+heightColorBias,0.0,1.0);
  float slopeMask = clamp(slope*slopeColorStrength+slopeColorBias,0.0,1.0);
  vec3 water = mix(deepColor,midColor,smoothstep(.08,.68,heightMask));
  water = mix(water,slopeColor,slopeMask*(1.0-heightMask*.45));
  water = mix(water,crestColor,smoothstep(.58,.98,heightMask)*.82);

  float lighting = clamp(dot(normal,normalize(-sunDirection))*.52+.52,0.0,1.0);
  lighting = clamp(lighting*shadingContrast+shadingBias,0.0,1.0);
  float stepped = floor(lighting*max(1.0,toneSteps)+.5)/max(1.0,toneSteps);
  lighting = mix(stepped,lighting,clamp(toneTransition,0.0,1.0));
  water *= .55+lighting*.64;
  water += crestColor*lighting*lightColorStrength;

  vec2 patchCell=floor((vWorld.xz+time*patchSpeed)/max(.1,patchScale));
  water *= 1.0+(hash(patchCell)-.5)*patchStrength*colorPatches;

  vec3 viewDir=normalize(cameraPosition-vWorld);
  float ndv=max(dot(normal,viewDir),0.0);
  float fresnel=clamp((.025+.86*pow(1.0-ndv,4.0))*fresnelStrength+fresnelBias,0.0,1.0);
  vec3 reflectedSky=mix(vec3(.08,.38,.62),vec3(.67,.86,.94),clamp(normal.y*.62+.22,0.0,1.0));
  water=mix(water,reflectedSky,fresnel*(.42+roughness*.22));

  vec3 halfDir=normalize(viewDir-normalize(sunDirection));
  float spec=pow(max(dot(normal,halfDir),0.0),max(2.0,highlightSharpness));
  vec2 glintUV=rotation(radians(glintAngle))*(vWorld.xz*vec2(glintScale,glintScale/max(.1,glintAspect)));
  float glintPattern=sin(glintUV.x*6.283)*sin(glintUV.y*6.283)+(hash(floor(glintUV*3.0))-.5)*glintDistortion;
  float glint=spec*smoothstep(glintThreshold,glintThreshold+.12,glintPattern);
  water+=highlightColor*(spec*.42+glint*2.6)*highlightStrength;

  float foamSignal=max(
    vCrests.x*foamWeights.x-foamBias.x,
    max(vCrests.y*foamWeights.y-foamBias.y,vCrests.z*foamWeights.z-foamBias.z)
  );
  foamSignal+=vHeight*foamHeightWeight+slope*foamSlopeWeight;
  vec2 foamUV=rotation(radians(foamMaskAngle))*(vWorld.xz*vec2(foamMaskScale,foamMaskScale/max(.1,foamMaskAspect))+time*foamSpeed);
  float foamPattern=fbm(foamUV)+(noise(foamUV*2.7)-.5)*foamDistortion;
  float broken=.24+.76*smoothstep(foamBreakup,foamBreakup+max(.02,foamEdgeSoftness),foamPattern);
  float foam=smoothstep(0.0,max(.02,foamEdgeSoftness),foamSignal)*broken*foamAmount*crestFoam;
  float dist=distance(cameraPosition,vWorld);
  foam*=1.0-smoothstep(foamFadeStart,foamFadeEnd,dist);
  water=mix(water,foamColor,clamp(foam,0.0,.96));

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
 vec3 horizon=mix(vec3(.50,.77,.91),vec3(1.0,.31,.09),sunset*.88);
 vec3 zenith=mix(vec3(.08,.38,.72),vec3(.34,.10,.29),sunset*.82);
 vec3 sky=mix(horizon,zenith,pow(y,mix(.48,.7,clamp(turbidity/30.0,0.0,1.0))));
 sky=mix(sky,vec3(.008,.025,.09),nightAmount*.94);
 float haze=pow(1.0-max(d.y,0.0),5.0);sky=mix(sky,horizon,haze*.35);
 float sun=pow(max(dot(d,normalize(-sunDirection)),0.0),4000.0);sky+=mix(vec3(1.0,.9,.65),vec3(1.0,.37,.12),sunset)*sun*2.8*(1.0-nightAmount);
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
${oceanWaveFunctions}
void main(){vec3 p=position;vec3 displacement;vec2 slope;vec3 crests;evaluateOcean(p.xz,displacement,slope,crests);p.y+=displacement.y+waterOffset;vWorld=(world*vec4(p,1.0)).xyz;gl_Position=worldViewProjection*vec4(p,1.0);}
`

export const wakeFragment = /* glsl */ `
precision highp float;
varying vec3 vWorld;
uniform float time;
uniform float originZ;
uniform float wakeLength;
uniform float initialWidth;
uniform float spread;
uniform float angle;
uniform float breakup;
uniform float textureScale;
uniform float brightness;
uniform vec3 wakeColor;
uniform vec3 wakeWaterColor;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){
 float distanceBehind=originZ-vWorld.z;float t=distanceBehind/max(1.0,wakeLength);
 if(t<0.0||t>1.0)discard;
 float armWidth=initialWidth+distanceBehind*tan(radians(angle)*.5)*spread;
 float edgeDistance=abs(abs(vWorld.x)-armWidth);
 float n=noise(vWorld.xz*textureScale+vec2(time*.12,-time*.26));
 float edge=smoothstep(1.15,.08,edgeDistance)*smoothstep(breakup-.12,breakup+.16,n);
 float center=smoothstep(initialWidth*1.35,0.0,abs(vWorld.x))*smoothstep(.3,0.0,t)*smoothstep(breakup-.18,breakup+.2,noise(vWorld.xz*textureScale*1.8-time*.2));
 float alpha=clamp((edge+center)*(1.0-smoothstep(.48,1.0,t)),0.0,.92);
 vec3 color=mix(wakeWaterColor,wakeColor,clamp(edge+center*.7,0.0,1.0))*brightness;
 gl_FragColor=vec4(color,alpha);
}`
