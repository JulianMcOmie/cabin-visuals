import { useRef, useEffect } from 'react'
import { Group, Mesh, SphereGeometry, PlaneGeometry, ShaderMaterial, AdditiveBlending, DoubleSide } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// Ported from Excellent DAW. A fiery orb with an animated fbm-noise surface, limb
// darkening and a corona glow. Play pitch 48 (C3) for a white-hot flash, 49 for a
// vivid colour pulse. Shaders are Tyler's verbatim.

const PITCH_FLASH = 48
const PITCH_COLOR_PULSE = 49
const PULSE_COLORS = [0.58, 0.83, 0.30, 0.12, 0.50, 0.75]
const FLASH_WINDOW = 0.6 // seconds a flash contributes
const PULSE_WINDOW = 0.8 // seconds a colour pulse contributes

const NOISE_GLSL = `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy; i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }
  vec3 hsv2rgb(vec3 c){vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0); vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www); return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);}
`

const vertexShader = `
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vPosition;
  void main(){ vUv=uv; vNormal=normalize(normalMatrix*normal); vPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`
const fragmentShader = `
  uniform float uTime,uIntensity,uBaseHue,uTurbulence,uSpeed,uFlashMix,uFlashPhase,uColorPulseMix,uColorPulseHue;
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vPosition;
  ${NOISE_GLSL}
  float fbm(vec3 p){ float f=0.0; f+=0.5*snoise(p); p*=2.01; f+=0.25*snoise(p); p*=2.02; f+=0.125*snoise(p); p*=2.03; f+=0.0625*snoise(p); return f; }
  void main(){
    float t=uTime*uSpeed;
    vec3 noisePos=vPosition*1.5+vec3(t*0.3,t*0.2,t*0.1);
    float noise=fbm(noisePos*uTurbulence)*uTurbulence;
    float facing=dot(vNormal,vec3(0.0,0.0,1.0));
    float limbDarkening=pow(max(facing,0.0),0.6);
    float edgeFactor=1.0-limbDarkening;
    float hue=uBaseHue+noise*0.05;
    float saturation=0.3+edgeFactor*0.7+noise*0.1;
    float value=(0.8+noise*0.2)*limbDarkening*uIntensity;
    float coreFactor=pow(limbDarkening,2.0);
    saturation*=(1.0-coreFactor*0.6);
    value=value+coreFactor*0.5*uIntensity;
    vec3 baseColor=hsv2rgb(vec3(hue,clamp(saturation,0.0,1.0),clamp(value,0.0,3.0)));
    if(uFlashMix>0.0){
      vec3 flashWhite=hsv2rgb(vec3(hue,saturation*0.15,clamp(value*2.5,0.0,4.0)));
      float compHue=fract(hue+0.5);
      vec3 flashComp=hsv2rgb(vec3(compHue,clamp(saturation+0.3,0.0,1.0),clamp(value*1.8,0.0,3.5)));
      baseColor=mix(baseColor,mix(flashComp,flashWhite,uFlashPhase),uFlashMix);
    }
    if(uColorPulseMix>0.0){
      float pulseSat=mix(0.7,0.95,edgeFactor);
      baseColor=mix(baseColor,hsv2rgb(vec3(uColorPulseHue,pulseSat,clamp(value*2.0,0.0,3.5))),uColorPulseMix);
    }
    gl_FragColor=vec4(baseColor,1.0);
  }
`
const coronaFragmentShader = `
  uniform float uIntensity,uBaseHue,uCoronaSize,uTime,uSpeed,uTurbulence,uFlashMix,uFlashPhase,uColorPulseMix,uColorPulseHue;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main(){
    vec2 center=vUv*2.0-1.0; float dist=length(center);
    float innerRadius=0.5; float outerRadius=innerRadius+uCoronaSize*0.5;
    if(dist<innerRadius||dist>outerRadius) discard;
    float t=uTime*uSpeed; float angle=atan(center.y,center.x);
    float noiseVal=snoise(vec3(angle*2.0,dist*3.0,t*0.5))*uTurbulence*0.5;
    float falloff=1.0-smoothstep(innerRadius,outerRadius,dist-noiseVal*0.1); falloff=pow(falloff,2.0);
    float hue=uBaseHue+noiseVal*0.03;
    vec3 baseColor=hsv2rgb(vec3(hue,0.6,uIntensity*falloff));
    float baseAlpha=falloff*0.6*uIntensity;
    if(uFlashMix>0.0){
      vec3 flashWhite=hsv2rgb(vec3(hue,0.1,uIntensity*falloff*2.5));
      float compHue=fract(hue+0.5);
      vec3 flashComp=hsv2rgb(vec3(compHue,0.8,uIntensity*falloff*1.8));
      baseColor=mix(baseColor,mix(flashComp,flashWhite,uFlashPhase),uFlashMix);
      baseAlpha=mix(baseAlpha,min(1.0,baseAlpha*2.0),uFlashMix);
    }
    if(uColorPulseMix>0.0){
      baseColor=mix(baseColor,hsv2rgb(vec3(uColorPulseHue,0.85,uIntensity*falloff*2.0)),uColorPulseMix);
      baseAlpha=mix(baseAlpha,min(1.0,baseAlpha*1.8),uColorPulseMix);
    }
    gl_FragColor=vec4(baseColor,baseAlpha);
  }
`
const coronaVertexShader = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }'

const PARAMS: ParamDef[] = [
  { key: 'size', label: 'Size', min: 0.5, max: 20, step: 0.1, default: 2.5 },
  { key: 'intensity', label: 'Intensity', min: 0.1, max: 3, step: 0.1, default: 1.5 },
  { key: 'baseHue', label: 'Base Hue', min: 0, max: 1, step: 0.01, default: 0.08 },
  { key: 'turbulence', label: 'Turbulence', min: 0, max: 2, step: 0.1, default: 0.8 },
  { key: 'speed', label: 'Speed', min: 0, max: 3, step: 0.1, default: 0.5 },
  { key: 'coronaSize', label: 'Corona Size', min: 0, max: 2, step: 0.1, default: 0.3 },
  { key: 'z', label: 'Depth (Z)', min: -40, max: 4, step: 0.5, default: -6 },
]
const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

function SunVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const sunMatRef = useRef<ShaderMaterial | null>(null)
  const coronaMatRef = useRef<ShaderMaterial | null>(null)
  const coronaMeshRef = useRef<Mesh | null>(null)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const baseUniforms = () => ({
      uTime: { value: 0 }, uIntensity: { value: 1.5 }, uBaseHue: { value: 0.08 },
      uTurbulence: { value: 0.8 }, uSpeed: { value: 0.5 },
      uFlashMix: { value: 0 }, uFlashPhase: { value: 0 }, uColorPulseMix: { value: 0 }, uColorPulseHue: { value: 0 },
    })
    const sunGeom = new SphereGeometry(1, 64, 64)
    const sunMat = new ShaderMaterial({ vertexShader, fragmentShader, uniforms: baseUniforms() })
    const sunMesh = new Mesh(sunGeom, sunMat)
    group.add(sunMesh)
    sunMatRef.current = sunMat

    const coronaGeom = new PlaneGeometry(1, 1)
    const coronaMat = new ShaderMaterial({
      vertexShader: coronaVertexShader, fragmentShader: coronaFragmentShader,
      transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
      uniforms: { ...baseUniforms(), uCoronaSize: { value: 0.3 } },
    })
    const coronaMesh = new Mesh(coronaGeom, coronaMat)
    group.add(coronaMesh)
    coronaMatRef.current = coronaMat
    coronaMeshRef.current = coronaMesh

    return () => {
      group.remove(sunMesh); group.remove(coronaMesh)
      sunGeom.dispose(); sunMat.dispose(); coronaGeom.dispose(); coronaMat.dispose()
    }
  }, [])

  useInstrumentFrame(trackId, (state) => {
    const group = groupRef.current
    const sunMat = sunMatRef.current
    const coronaMat = coronaMatRef.current
    if (!group || !sunMat || !coronaMat) return

    const p = state.params
    const size = p.size ?? 2.5
    const intensity = p.intensity ?? 1.5
    const baseHue = p.baseHue ?? 0.08
    const turbulence = p.turbulence ?? 0.8
    const speed = p.speed ?? 0.5
    const coronaSize = p.coronaSize ?? 0.3
    const z = p.z ?? -6

    // Flashes/pulses derive purely from the note list + current beat (no spawn
    // lists), so a paused playhead is a frozen frame and scrub-back is exact.
    let flashMix = 0, newestFlashAge = -1
    let pulseMix = 0, pulseHue = 0, newestPulseAge = -1
    let pulseIdx = 0
    for (const n of state.notes) {
      if (n.pitch !== PITCH_FLASH && n.pitch !== PITCH_COLOR_PULSE) continue
      const age = (state.beat - n.beat) * state.secPerBeat
      if (n.pitch === PITCH_FLASH) {
        if (age < 0 || age >= FLASH_WINDOW) continue
        flashMix = Math.min(1, flashMix + Math.min(1, age / 0.008) * Math.exp(-age * 8))
        if (newestFlashAge < 0 || age < newestFlashAge) newestFlashAge = age
      } else {
        const hue = PULSE_COLORS[pulseIdx % PULSE_COLORS.length]; pulseIdx++
        if (age < 0 || age >= PULSE_WINDOW) continue
        pulseMix = Math.min(1, pulseMix + Math.min(1, age / 0.01) * Math.exp(-age * 5))
        if (newestPulseAge < 0 || age < newestPulseAge) { newestPulseAge = age; pulseHue = hue }
      }
    }
    const flashPhase = newestFlashAge >= 0 ? Math.max(0, 1 - newestFlashAge * 12) : 0

    const totalIntensity = intensity + flashMix * 2 + pulseMix
    group.position.z = z
    group.scale.setScalar(size * (1 + flashMix * 0.15 * flashPhase))
    const coronaMesh = coronaMeshRef.current
    if (coronaMesh) { const cs = 2 + (coronaSize + flashMix * 0.8) * 2; coronaMesh.scale.set(cs, cs, 1) }

    // Surface time follows the transport (beat → seconds), freezing on pause.
    const t = state.beat * state.secPerBeat
    const su = sunMat.uniforms
    su.uTime.value = t; su.uIntensity.value = totalIntensity; su.uBaseHue.value = baseHue
    su.uTurbulence.value = turbulence; su.uSpeed.value = speed
    su.uFlashMix.value = flashMix; su.uFlashPhase.value = flashPhase; su.uColorPulseMix.value = pulseMix; su.uColorPulseHue.value = pulseHue
    const cu = coronaMat.uniforms
    cu.uTime.value = t; cu.uIntensity.value = totalIntensity; cu.uBaseHue.value = baseHue; cu.uCoronaSize.value = coronaSize + flashMix * 0.8
    cu.uSpeed.value = speed; cu.uTurbulence.value = turbulence
    cu.uFlashMix.value = flashMix; cu.uFlashPhase.value = flashPhase; cu.uColorPulseMix.value = pulseMix; cu.uColorPulseHue.value = pulseHue
  })

  return <group ref={groupRef} />
}

export const sunInstrument: ObjectInstrumentDef = {
  id: 'sun',
  name: 'Sun',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: SunVisual,
}
