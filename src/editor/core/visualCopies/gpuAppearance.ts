import { Color, Vector3 } from 'three'
import type { MoverOrSplitterContext, VisualCopy } from './types'
import type { GpuOperation } from './gpuOperations'
import type { buildGradientPath } from './gradientPath'
import type { ResolvedNote } from '../visual/types'
import { midiVelocity } from '../../utils/midiVelocity'
import { oklchToHex } from '../../utils/oklch'

/** Appearance stages operate on the accumulated colorShift, not on rendered
 * RGB. A later tint replaces an earlier tint; relative channels apply once,
 * after the complete chain. All offsets in this record are scalar offsets. */
export interface GpuAppearanceOperation extends GpuOperation {
  kind: 5
  parameters: readonly number[]
  scaleBound: 1
  positionScaleBound: 1
  translationBound: 0
  determinantPreserving: true
}

export interface AppearanceMapping {
  /** X/Y/radial/spherical/Z/index=0..5; projected XY=6; depth=7;
   * nearest-path along/distance=8/9. */
  mode: number
  span?: number
  offset?: number
  bias?: number
  single?: number
  axis?: readonly [number, number]
  flip?: boolean
  clamp?: boolean
  path?: ReturnType<typeof buildGradientPath>
}

const PALETTE = 1, HUE = 2, PRINT = 3, NOTE = 4, NOTE_TIMELINE = 5, SPARSE_OPACITY = 6
const HEADER = 28, MAP = 2
const BAYER = [0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21]
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const wrap = (x: number, span = 1) => ((x % span) + span) % span
const packedColors = new WeakMap<readonly (string | null)[], readonly number[]>()
const decodedColors = new WeakMap<readonly number[], Map<number, string | null>>()
const supportedParameters = new WeakMap<readonly number[], boolean>()
const samplePosition = new Vector3()

function begin(kind: number, mapping: AppearanceMapping = { mode: 5 }): number[] {
  const p = new Array<number>(HEADER).fill(0)
  p[0] = kind
  const m = MAP
  p[m] = mapping.mode; p[m+1] = mapping.span ?? 1; p[m+2] = mapping.offset ?? 0
  p[m+3] = mapping.bias ?? 0; p[m+4] = mapping.single ?? .5
  p[m+5] = mapping.axis?.[0] ?? 1; p[m+6] = mapping.axis?.[1] ?? 0
  p[m+7] = mapping.flip ? 1 : 0; p[m+8] = mapping.clamp ? 1 : 0
  if (mapping.path) packPath(p, mapping.path)
  return p
}

function finish(parameters: number[]): GpuAppearanceOperation {
  parameters[1] = parameters.length
  return { kind: 5, parameters, scaleBound: 1, positionScaleBound: 1, translationBound: 0, determinantPreserving: true }
}

/** Nearest sampling preserves the definitions' shipped hex LUTs exactly. Raw
 * strings ride beside linear RGB so inspection also preserves case and invalid
 * saved values; the shader only reads the fixed-size RGB/validity records. */
function packColors(p: number[], colors: readonly (string | null)[]): number {
  const offset = p.length
  let packed = packedColors.get(colors)
  if (!packed) {
    const data = new Array<number>(colors.length * 6).fill(0), color = new Color()
    colors.forEach((hex, i) => {
      const record = i * 6, valid = typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)
      if (valid) { color.set(hex!); data[record] = color.r; data[record+1] = color.g; data[record+2] = color.b }
      data[record+3] = valid ? 1 : 0; data[record+4] = data.length; data[record+5] = hex === null ? -1 : hex.length
      if (hex !== null) for (let n = 0; n < hex.length; n++) data.push(hex.charCodeAt(n))
    })
    packed = data
    packedColors.set(colors, packed)
  }
  for (const scalar of packed) p.push(scalar)
  for (let i = 0; i < colors.length; i++) p[offset+i*6+4] += offset
  return offset
}

function colorText(p: readonly number[], offset: number, index: number): string | null {
  const record = offset + index * 6, length = p[record+5]
  let decoded = decodedColors.get(p)
  if (!decoded) { decoded = new Map(); decodedColors.set(p, decoded) }
  if (!decoded.has(record)) decoded.set(record, length < 0 ? null : String.fromCharCode(...p.slice(p[record+4], p[record+4] + length)))
  return decoded.get(record)!
}

/** Segment BVH avoids a linear walk of all 4,032 tessellated curve segments
 * for every particle. Leaves keep original segment ordinals for strict ties. */
function packPath(p: number[], path: ReturnType<typeof buildGradientPath>) {
  const count = path.points.length - 1, offset = p.length
  p[MAP+9] = offset; p.push(count, path.total)
  const bounds = Array.from({ length: count }, (_, index) => {
    const a = path.points[index], b = path.points[index+1], delta = b.map((v,k) => v-a[k])
    p.push(...a, ...delta, Math.hypot(...delta), path.lengths[index])
    return { index, min: a.map((v,k) => Math.min(v,b[k])), max: a.map((v,k) => Math.max(v,b[k])) }
  })
  const nodes: number[][] = []
  const build = (items: typeof bounds): number => {
    const index = nodes.length, min = [0,1,2].map(k => Math.min(...items.map(v => v.min[k])))
    const max = [0,1,2].map(k => Math.max(...items.map(v => v.max[k])))
    const node = [...min, ...max, -1, -1, -1]; nodes.push(node)
    if (items.length === 1) node[8] = items[0].index
    else {
      const axis = max.map((v,k) => v-min[k]).reduce((best,v,k,all) => v>all[best] ? k : best, 0)
      items.sort((a,b) => a.min[axis]+a.max[axis]-b.min[axis]-b.max[axis])
      const split = Math.floor(items.length/2)
      node[6] = build(items.slice(0,split)); node[7] = build(items.slice(split))
    }
    return index
  }
  build(bounds)
  p[MAP+10] = p.length; p[MAP+11] = nodes.length
  for (const node of nodes) p.push(...node)
}

export function paletteAppearance(mapping: AppearanceMapping, colors: readonly string[], amount: number,
  options: { scale?: number; phase?: number; phaseExtra?: number; wrap?: boolean; rounded?: boolean; perceptual?: boolean } = {}): GpuAppearanceOperation {
  const p = begin(PALETTE, mapping)
  p[14] = options.scale ?? 1; p[15] = options.phase ?? 0; p[16] = options.wrap ? 1 : 0; p[17] = options.rounded ? 1 : 0
  p[18] = packColors(p, colors); p[19] = colors.length; p[20] = clamp01(amount)
  p[21] = options.perceptual === undefined ? -1 : options.perceptual ? 1 : 0
  p[22] = options.phaseExtra ?? 0
  return finish(p)
}

export function hueAppearance(mapping: AppearanceMapping, base: number, spread: number, saturation: number,
  lightness: number, perceptual: boolean): GpuAppearanceOperation {
  const p = begin(HUE, mapping)
  p[14] = base; p[15] = spread; p[16] = saturation; p[17] = lightness; p[18] = perceptual ? 1 : 0
  return finish(p)
}

export function printAppearance(mapping: AppearanceMapping, colors: readonly string[], amount: number,
  tone: number, ink: number, screen: number, grain: number, perceptual: boolean): GpuAppearanceOperation {
  const p = begin(PRINT, mapping)
  p[14] = tone; p[15] = ink; p[16] = screen === 0 || screen === 1 ? screen : 2; p[17] = Math.max(.001,grain)
  p[18] = packColors(p, colors); p[19] = clamp01(amount); p[20] = perceptual ? 1 : 0
  return finish(p)
}

export function noteAppearance(tint: string | null, amount: number, hueBase: number, hueSlope: number,
  perceptual: boolean): GpuAppearanceOperation {
  const p = begin(NOTE)
  p[14] = hueBase; p[15] = hueSlope; p[16] = packColors(p,[tint]); p[17] = tint ? amount : 0; p[18] = perceptual ? 1 : 0
  return finish(p)
}

/** A missing row is invisible. The table contains only authored rows, never
 * one entry per particle. Two 16-bit limbs keep large indices exact in the
 * float texture; negative/fractional rows cannot address a copy. */
export function sparseOpacityAppearance(grouping: number, gains: ReadonlyMap<number, number>): GpuAppearanceOperation {
  const p = begin(SPARSE_OPACITY)
  p[14] = grouping
  p[15] = grouping > 0 ? Math.ceil(100 / grouping) : 0
  p[23] = p.length
  const rows = [...gains].filter(([index]) => Number.isSafeInteger(index) && index >= 0).sort((a,b) => a[0]-b[0])
  p[24] = rows.length
  for (const [index, gain] of rows) p.push(Math.floor(index / 65536), index % 65536, clamp01(gain))
  return finish(p)
}

function sparseOpacity(p: readonly number[], index: number, count: number): number {
  const groups = Math.min(count, p[15])
  const row = p[14] < 0 ? 0 : p[14] === 0 ? index : Math.min(groups - 1, Math.floor(index / Math.max(1, count) * groups))
  let low = 0, high = p[24]
  while (low < high) {
    const middle = Math.floor((low + high) / 2), at = p[23] + middle * 3, key = p[at] * 65536 + p[at+1]
    if (key < row) low = middle + 1
    else high = middle
  }
  const at = p[23] + low * 3
  return low < p[24] && p[at] * 65536 + p[at+1] === row ? p[at+2] : 0
}

export interface NoteAppearanceSettings {
  staggerBeats: number; attackBeats: number; releaseBeats: number; shape: number
  rainbowRate: number; rainbowSpread: number; intensity: number; blend: number
}
interface SlotColor { hex: string; l: number; a: number; b: number }

/** Static, sorted note data is shared by every copy. A shader binary search
 * skips history outside the longest possible envelope, then visits only the
 * candidate window. Cost tracks overlapping score events, not CPU copies. */
export function staggeredNoteAppearance(settings: NoteAppearanceSettings, notes: readonly ResolvedNote[],
  palette: readonly (SlotColor | null)[], beat: number): GpuAppearanceOperation {
  const p=begin(NOTE_TIMELINE)
  p[14]=beat;p[15]=settings.staggerBeats;p[16]=Math.max(0,settings.attackBeats);p[17]=Math.max(0,settings.releaseBeats)
  p[18]=settings.shape===1||settings.shape===2?settings.shape:0;p[19]=settings.rainbowRate;p[20]=settings.rainbowSpread;p[21]=clamp01(settings.intensity);p[22]=settings.blend!==1?1:0
  p[25]=packColors(p,palette.map(color=>color?.hex??null));p[26]=p.length
  for(const color of palette)p.push(color?.l??0,color?.a??0,color?.b??0,color?1:0)
  const pitches=[60,62,63,64,65,61]
  const events=notes.map((note,order)=>({note,order,row:pitches.indexOf(note.pitch)}))
    .filter(event=>event.row>=0).sort((a,b)=>a.note.beat-b.note.beat||a.order-b.order)
  p[23]=p.length;p[24]=events.length
  for(const {note,order,row}of events){
    const hold=Math.max(0,note.durationBeats,p[16]);p[27]=Math.max(p[27],hold+p[17])
    p.push(note.beat,note.durationBeats,clamp01(midiVelocity(note.velocity)),row,order)
  }
  return finish(p)
}

export function appearanceTimelineAtBeat(operation: GpuAppearanceOperation, beat: number): GpuAppearanceOperation {
  const parameters=operation.parameters.slice();parameters[14]=beat
  return {...operation,parameters}
}

function noteGain(age:number,duration:number,attack:number,release:number,shape:number):number{
  if(age<0)return 0
  const hold=Math.max(0,duration,attack)
  if(age<attack){const t=age/attack;return shape===2?t*t:t}
  if(age<hold)return 1
  if(release<=0)return 0
  const remaining=1-(age-hold)/release
  if(remaining<=0)return 0
  return shape===1?remaining:shape===2?remaining*remaining*(3-2*remaining):remaining**3
}

function temporalNote(p:readonly number[],index:number,diagonal:number){
  const beat=p[14]-p[15]*Math.max(0,Math.floor(index)),gains=[0,0,0,0,0]
  let low=0,high=p[24]
  while(low<high){const mid=(low+high)>>>1;if(p[p[23]+mid*5]<beat-p[27])low=mid+1;else high=mid}
  let rainbowGain=0,rainbowAge=0,rainbowOrder=Infinity
  for(let i=low;i<p[24];i++){
    const n=p[23]+i*5;if(p[n]>beat)break
    const age=beat-p[n],gain=noteGain(age,p[n+1],p[16],p[17],p[18])*p[n+2],row=p[n+3]
    if(row<5)gains[row]=Math.max(gains[row],gain)
    else if(gain>rainbowGain||(gain>0&&gain===rainbowGain&&p[n+4]<rainbowOrder)){rainbowGain=gain;rainbowAge=age;rainbowOrder=p[n+4]}
  }
  const gainPeak=Math.max(...gains),sounding=gains.filter(gain=>gain>0).length
  let tint:string|null=null
  if(gainPeak>0){
    const loudest=gains.indexOf(gainPeak)
    if(sounding<=1)tint=colorText(p,p[25],loudest)
    else{
      let weight=0,l=0,a=0,b=0
      for(let slot=0;slot<5;slot++){const at=p[26]+slot*4,gain=gains[slot];if(gain<=0||p[at+3]===0)continue;weight+=gain;l+=p[at]*gain;a+=p[at+1]*gain;b+=p[at+2]*gain}
      if(weight>0)tint=oklchToHex(l/weight,Math.hypot(a/weight,b/weight),Math.atan2(b/weight,a/weight)*180/Math.PI)
      else tint=colorText(p,p[25],loudest)
    }
  }
  return {tint,amount:p[21]*gainPeak,hue:rainbowGain>0?(rainbowAge*p[19]+diagonal*p[20])*rainbowGain:0}
}

export function isGpuAppearanceSupported(operation: GpuOperation): operation is GpuAppearanceOperation {
  // Parameter arrays are immutable operation data. Cache their potentially
  // large LUT/BVH validation, while checking enclosing metadata every time.
  if (operation.kind !== 5 || operation.scaleBound !== 1 || operation.positionScaleBound !== 1
    || operation.translationBound !== 0 || operation.determinantPreserving !== true) return false
  const p = operation.parameters, cached = supportedParameters.get(p)
  if (cached !== undefined) return cached
  const supported = appearanceParametersSupported(p)
  supportedParameters.set(p, supported)
  return supported
}

function appearanceParametersSupported(p: readonly number[]): boolean {
  const header = p.length >= HEADER && p[1] === p.length && Number.isInteger(p[0])
    && p[0] >= PALETTE && p[0] <= SPARSE_OPACITY && p.every(Number.isFinite)
  if(!header)return false
  const range=(offset:number,count:number,stride=1)=>Number.isSafeInteger(offset)&&offset>=HEADER
    &&Number.isSafeInteger(count)&&count>=0&&Number.isSafeInteger(offset+count*stride)&&offset+count*stride<=p.length
  const colors=(offset:number,count:number)=>range(offset,count,6)&&Array.from({length:count},(_,i)=>{
    const record=offset+i*6,length=p[record+5]
    return (p[record+3]===0||p[record+3]===1)&&(length===-1||range(p[record+4],length)
      &&p.slice(p[record+4],p[record+4]+length).every(code=>Number.isInteger(code)&&code>=0&&code<=65535))
  }).every(Boolean)
  if(!Number.isInteger(p[MAP])||p[MAP]<0||p[MAP]>9)return false
  if(p[MAP]>=8){
    const path=p[MAP+9],nodes=p[MAP+10],count=p[MAP+11]
    if(!range(path,2)||!Number.isInteger(p[path])||p[path]<1||p[path]>4032||!range(path+2,p[path],8)
      ||count!==p[path]*2-1||!range(nodes,count,9))return false
    const pending:Array<[number,number]>=[[0,1]],seen=new Set<number>()
    while(pending.length){
      const [node,depth]=pending.pop()!
      if(!Number.isInteger(node)||node<0||node>=count||depth>15||seen.has(node))return false
      seen.add(node);const at=nodes+node*9,segment=p[at+8]
      if(![0,1,2].every(k=>p[at+k]<=p[at+3+k]))return false
      if(segment===-1)pending.push([p[at+6],depth+1],[p[at+7],depth+1])
      else if(!Number.isInteger(segment)||segment<0||segment>=p[path])return false
    }
    if(seen.size!==count)return false
  }
  if(p[0]===PALETTE)return p[19]>0&&colors(p[18],p[19])
  if(p[0]===PRINT)return colors(p[18],4)
  if(p[0]===NOTE)return colors(p[16],1)
  if(p[0]===NOTE_TIMELINE){
    if(!colors(p[25],5)||!range(p[26],5,4)||!range(p[23],p[24],5))return false
    let previous=-Infinity
    for(let i=0;i<p[24];i++){
      const at=p[23]+i*5,row=p[at+3]
      if(p[at]<previous||!Number.isInteger(row)||row<0||row>5||!Number.isInteger(p[at+4])||p[at+4]<0)return false
      if(p[at+2]<0||p[at+2]>1||Math.max(0,p[at+1],p[16])+p[17]>p[27])return false
      previous=p[at]
    }
  }
  if(p[0]===SPARSE_OPACITY){
    if(!range(p[23],p[24],3)||p[15] < 0||!Number.isInteger(p[15]))return false
    let previous=-1
    for(let i=0;i<p[24];i++){
      const at=p[23]+i*3,high=p[at],low=p[at+1],key=high*65536+low
      if(!Number.isInteger(high)||high<0||high>32767||!Number.isInteger(low)||low<0||low>65535
        ||key<=previous||p[at+2]<0||p[at+2]>1)return false
      previous=key
    }
  }
  return true
}

function mapPosition(p: readonly number[], index: number, count: number, x: number, y: number, z: number): number {
  const m = MAP, mode = p[m]
  let t: number
  if (mode === 5) t = count > 1 ? index/(count-1) : p[m+4]
  else if (mode >= 8) {
    const path = p[m+9], segments = p[path], total = p[path+1]
    let best = Infinity, along = 0
    for (let segment=0;segment<segments;segment++) {
      const s = path+2+segment*8, dx=p[s+3],dy=p[s+4],dz=p[s+5], squared=dx*dx+dy*dy+dz*dz
      const relative=[x-p[s],y-p[s+1],z-p[s+2]]
      const u=squared<1e-16 ? 0 : clamp01((relative[0]*dx+relative[1]*dy+relative[2]*dz)/squared)
      const distance=(relative[0]-u*dx)**2+(relative[1]-u*dy)**2+(relative[2]-u*dz)**2
      if(distance<best){best=distance;along=p[s+7]+u*Math.sqrt(squared)}
    }
    t = mode===9 ? Math.sqrt(best)/Math.max(.001,p[m+1]) : total<1e-8 ? .5 : along/total
  } else if (mode === 7) t = Math.abs(p[m+1])<1e-8 ? .5 : (z-p[m+2])/p[m+1]
  else {
    const value=mode===0 ? x : mode===1 ? y : mode===3 ? Math.hypot(x,y,z) : mode===4 ? z : mode===6 ? x*p[m+5]+y*p[m+6] : Math.hypot(x,y)
    t=p[m+3]+(value-p[m+2])/Math.max(.001,p[m+1])
  }
  if(p[m+7])t=1-t
  return p[m+8] ? clamp01(t) : t
}

const screen = (x: number,y: number) => (BAYER[wrap(Math.round(y),8)*8+wrap(Math.round(x),8)]+.5)/64

export function applyGpuAppearance(operation: GpuOperation, copy: VisualCopy, context: MoverOrSplitterContext): VisualCopy {
  if(operation.parameters[0]===SPARSE_OPACITY)return {transform:copy.transform.clone(),
    opacity:copy.opacity*sparseOpacity(operation.parameters,context.index,context.count),colorShift:{...copy.colorShift}}
  const p=operation.parameters, colorShift={...copy.colorShift}, position=samplePosition.setFromMatrixPosition(copy.transform)
  if(context.placementTransform)position.applyMatrix4(context.placementTransform)
  const t=mapPosition(p,context.index,context.count,position.x,position.y,position.z)
  const tint=(offset:number,index:number,amount:number,perceptual:number)=>{
    colorShift.tint=colorText(p,offset,index);colorShift.tintAmount=amount
    if(perceptual>=0)colorShift.tintPerceptual=perceptual>=.5
  }
  if(p[0]===PALETTE&&p[20]>0){
    let u=p[14]*t+p[15]+p[22];u=p[16] ? wrap(u) : clamp01(u)
    const index=p[17] ? Math.round(u*(p[19]-1)) : Math.floor(u*p[19])%p[19]
    tint(p[18],index,p[20],p[21])
  }else if(p[0]===HUE){
    colorShift.hue+=p[14]+p[15]*t;colorShift.saturation+=p[16];colorShift.lightness+=p[17];colorShift.huePerceptual=p[18]>=.5
  }else if(p[0]===PRINT&&p[19]>0){
    const tone=clamp01(t+p[14]),coverageA=clamp01(tone+p[15]),coverageB=clamp01(1-tone+p[15])
    let a=.5,b=.5
    if(p[16]===0){const x=position.x/p[17],y=position.y/p[17];a=screen(x,y);b=screen(x+3,y+5)}
    else if(p[16]===1){a=screen(context.index,Math.floor(context.index/8));b=screen(context.index+3,Math.floor(context.index/8)+5)}
    tint(p[18],(coverageA>=a?1:0)|(coverageB>b?2:0),p[19],p[20])
  }else if(p[0]===NOTE){
    colorShift.hue+=p[14]+p[15]*(position.x+position.y)*Math.SQRT1_2
    if(p[17]>0)tint(p[16],0,p[17],p[18])
  }else if(p[0]===NOTE_TIMELINE){
    const output=temporalNote(p,context.index,(position.x+position.y)*Math.SQRT1_2)
    colorShift.hue+=output.hue
    if(output.amount>0&&output.tint){colorShift.tint=output.tint;colorShift.tintAmount=output.amount;colorShift.tintPerceptual=p[22]>=.5}
  }
  return {transform:copy.transform.clone(),opacity:copy.opacity,colorShift}
}

export const GPU_APPEARANCE_GLSL = `
  const int appearanceBayer[64]=int[64](${BAYER.join(',')});
  vec3 appearanceTriple(int offset){return vec3(layoutScalar(offset),layoutScalar(offset+1),layoutScalar(offset+2));}
  float appearanceScreen(float x,float y){
    int ix=int(mod(floor(x+0.5),8.0)),iy=int(mod(floor(y+0.5),8.0));
    return (float(appearanceBayer[iy*8+ix])+0.5)/64.0;
  }
  float appearanceMap(vec3 position,int offset,int inputIndex,int inputCount){
    int m=offset+2,mode=int(layoutScalar(m));float t=0.0;
    if(mode==5)t=inputCount>1 ? float(inputIndex)/float(inputCount-1) : layoutScalar(m+4);
    else if(mode>=8){
      int path=offset+int(layoutScalar(m+9)),nodes=offset+int(layoutScalar(m+10));
      float best=3.402823466e38,along=0.0;int bestSegment=2147483647;
      int stack[16];int stackSize=1;stack[0]=0;
      for(int visit=0;visit<8063;visit++){
        if(stackSize==0)break;int node=nodes+stack[--stackSize]*9;
        vec3 low=appearanceTriple(node),high=appearanceTriple(node+3);
        vec3 outside=max(max(low-position,position-high),vec3(0.0));
        if(dot(outside,outside)>best+max(1e-8,best*1e-5))continue;
        int segment=int(layoutScalar(node+8));
        if(segment<0){stack[stackSize++]=int(layoutScalar(node+7));stack[stackSize++]=int(layoutScalar(node+6));continue;}
        int s=path+2+segment*8;vec3 relative=position-appearanceTriple(s),delta=appearanceTriple(s+3);
        float squared=dot(delta,delta),u=squared<1e-16 ? 0.0 : clamp(dot(relative,delta)/squared,0.0,1.0);
        vec3 remainder=relative-u*delta;float distance=dot(remainder,remainder);
        if(distance<best||(distance==best&&segment<bestSegment)){best=distance;bestSegment=segment;along=layoutScalar(s+7)+u*sqrt(squared);}
      }
      float total=layoutScalar(path+1);
      t=mode==9 ? sqrt(best)/max(0.001,layoutScalar(m+1)) : total<1e-8 ? 0.5 : along/total;
    }else if(mode==7){float span=layoutScalar(m+1);t=abs(span)<1e-8 ? 0.5 : (position.z-layoutScalar(m+2))/span;}
    else{
      float value=mode==0 ? position.x : mode==1 ? position.y : mode==3 ? length(position) : mode==4 ? position.z : mode==6 ? dot(position.xy,vec2(layoutScalar(m+5),layoutScalar(m+6))) : length(position.xy);
      t=layoutScalar(m+3)+(value-layoutScalar(m+2))/max(0.001,layoutScalar(m+1));
    }
    if(layoutScalar(m+7)>0.5)t=1.0-t;
    return layoutScalar(m+8)>0.5 ? clamp(t,0.0,1.0) : t;
  }
  void appearanceTint(int record,float amount,float mode,inout vec3 tintRGB,inout float tintAmount,inout float tintPerceptual){
    tintRGB=appearanceTriple(record);tintAmount=layoutScalar(record+3)>0.5 ? amount : 0.0;
    if(mode>=0.0)tintPerceptual=mode;
  }
  float appearanceNoteGain(float age,float duration,float attack,float release,int shape){
    if(age<0.0)return 0.0;float hold=max(max(0.0,duration),attack);
    if(age<attack){float t=age/attack;return shape==2?t*t:t;}
    if(age<hold)return 1.0;if(release<=0.0)return 0.0;
    float remaining=1.0-(age-hold)/release;if(remaining<=0.0)return 0.0;
    return shape==1?remaining:shape==2?remaining*remaining*(3.0-2.0*remaining):remaining*remaining*remaining;
  }
  vec3 appearanceLabRaw(vec3 lab){
    vec3 lms=vec3(dot(lab,vec3(1.0,0.3963377774,0.2158037573)),dot(lab,vec3(1.0,-0.1055613458,-0.0638541728)),dot(lab,vec3(1.0,-0.0894841775,-1.2914855480)));
    lms=lms*lms*lms;
    return vec3(dot(lms,vec3(4.0767416621,-3.3077115913,0.2309699292)),dot(lms,vec3(-1.2684380046,2.6097574011,-0.3413193965)),dot(lms,vec3(-0.0041960863,-0.7034186147,1.7076147010)));
  }
  bool appearanceInGamut(vec3 rgb){return all(greaterThanEqual(rgb,vec3(-0.0001)))&&all(lessThanEqual(rgb,vec3(1.0001)));}
  float appearanceLinearToSrgb(float v){return v<=0.0031308?v*12.92:1.055*pow(v,1.0/2.4)-0.055;}
  float appearanceSrgbToLinear(float v){return v<=0.04045?v/12.92:pow((v+0.055)/1.055,2.4);}
  vec3 appearanceLabHex(vec3 lab){
    vec3 rgb=appearanceLabRaw(lab);
    if(!appearanceInGamut(rgb)){
      float low=0.0,high=1.0;
      for(int iteration=0;iteration<20;iteration++){
        float middle=(low+high)*0.5;
        if(appearanceInGamut(appearanceLabRaw(vec3(lab.x,lab.yz*middle))))low=middle;else high=middle;
      }
      rgb=appearanceLabRaw(vec3(lab.x,lab.yz*low));
    }
    vec3 srgb=vec3(appearanceLinearToSrgb(rgb.r),appearanceLinearToSrgb(rgb.g),appearanceLinearToSrgb(rgb.b));
    srgb=floor(clamp(srgb,0.0,1.0)*255.0+0.5)/255.0;
    return vec3(appearanceSrgbToLinear(srgb.r),appearanceSrgbToLinear(srgb.g),appearanceSrgbToLinear(srgb.b));
  }
  void appearanceNoteTimeline(vec3 position,int p,int inputIndex,inout float hue,
    inout vec3 tintRGB,inout float tintAmount,inout float tintPerceptual){
    float beat=layoutScalar(p+14)-layoutScalar(p+15)*float(max(0,inputIndex));
    int notes=p+int(layoutScalar(p+23)),count=int(layoutScalar(p+24));
    int low=0,high=count;
    for(int iteration=0;iteration<32;iteration++){
      if(low>=high)break;int middle=(low+high)/2;
      if(layoutScalar(notes+middle*5)<beat-layoutScalar(p+27))low=middle+1;else high=middle;
    }
    float gains[5]=float[5](0.0,0.0,0.0,0.0,0.0);
    float rainbowGain=0.0,rainbowAge=0.0;int rainbowOrder=2147483647;
    for(int candidate=low;candidate<count;candidate++){
      int n=notes+candidate*5;float onset=layoutScalar(n);if(onset>beat)break;
      float age=beat-onset,gain=appearanceNoteGain(age,layoutScalar(n+1),layoutScalar(p+16),layoutScalar(p+17),int(layoutScalar(p+18)))*layoutScalar(n+2);
      int row=int(layoutScalar(n+3)),order=int(layoutScalar(n+4));
      if(row<5)gains[row]=max(gains[row],gain);
      else if(gain>rainbowGain||(gain>0.0&&gain==rainbowGain&&order<rainbowOrder)){rainbowGain=gain;rainbowAge=age;rainbowOrder=order;}
    }
    if(rainbowGain>0.0)hue+=(rainbowAge*layoutScalar(p+19)+(position.x+position.y)*0.7071067811865476*layoutScalar(p+20))*rainbowGain;
    float gainPeak=0.0,weight=0.0;vec3 lab=vec3(0.0);int sounding=0,loudest=-1;
    for(int slot=0;slot<5;slot++){
      float gain=gains[slot];if(gain<=0.0)continue;sounding++;
      if(gain>gainPeak){gainPeak=gain;loudest=slot;}
      int at=p+int(layoutScalar(p+26))+slot*4;
      if(layoutScalar(at+3)>0.5){weight+=gain;lab+=appearanceTriple(at)*gain;}
    }
    float amount=layoutScalar(p+21)*gainPeak;if(amount<=0.0||loudest<0)return;
    int record=p+int(layoutScalar(p+25))+loudest*6;
    if(sounding<=1||weight<=0.0){
      if(layoutScalar(record+5)>0.0)appearanceTint(record,amount,layoutScalar(p+22),tintRGB,tintAmount,tintPerceptual);
    }else{tintRGB=appearanceLabHex(lab/weight);tintAmount=amount;tintPerceptual=layoutScalar(p+22);}
  }
  void applyParticleAppearance(mat4 frame,int scalarOffset,int inputIndex,int inputCount,
    inout float hue,inout float saturation,inout float lightness,inout vec3 tintRGB,
    inout float tintAmount,inout float tintPerceptual,inout float huePerceptual,inout float opacity){
    int p=scalarOffset,kind=int(layoutScalar(p));vec3 position=frame[3].xyz;
    if(kind==6){
      float grouping=layoutScalar(p+14),maximumGroups=layoutScalar(p+15);
      int groups=maximumGroups>=float(inputCount)?inputCount:int(maximumGroups);
      int row=grouping<0.0?0:grouping==0.0?inputIndex:min(groups-1,int(floor(float(inputIndex)/float(max(1,inputCount))*float(groups))));
      int rows=p+int(layoutScalar(p+23)),count=int(layoutScalar(p+24)),low=0,high=count;
      for(int iteration=0;iteration<32;iteration++){
        if(low>=high)break;int middle=(low+high)/2,at=rows+middle*3;
        int key=int(layoutScalar(at))*65536+int(layoutScalar(at+1));
        if(key<row)low=middle+1;else high=middle;
      }
      float gain=0.0;
      if(low<count){int at=rows+low*3,key=int(layoutScalar(at))*65536+int(layoutScalar(at+1));if(key==row)gain=layoutScalar(at+2);}
      opacity*=gain;return;
    }
    float t=appearanceMap(position,p,inputIndex,inputCount);
    if(kind==1&&layoutScalar(p+20)>0.0){
      float u=layoutScalar(p+14)*t+layoutScalar(p+15)+layoutScalar(p+22);u=layoutScalar(p+16)>0.5 ? fract(u) : clamp(u,0.0,1.0);
      int count=int(layoutScalar(p+19));int slot=layoutScalar(p+17)>0.5 ? int(floor(u*float(count-1)+0.5)) : int(floor(u*float(count)))%count;
      appearanceTint(p+int(layoutScalar(p+18))+slot*6,layoutScalar(p+20),layoutScalar(p+21),tintRGB,tintAmount,tintPerceptual);
    }else if(kind==2){
      hue+=layoutScalar(p+14)+layoutScalar(p+15)*t;saturation+=layoutScalar(p+16);lightness+=layoutScalar(p+17);huePerceptual=layoutScalar(p+18);
    }else if(kind==3&&layoutScalar(p+19)>0.0){
      float tone=clamp(t+layoutScalar(p+14),0.0,1.0),ink=layoutScalar(p+15);
      float coverageA=clamp(tone+ink,0.0,1.0),coverageB=clamp(1.0-tone+ink,0.0,1.0),a=0.5,b=0.5;
      int screen=int(layoutScalar(p+16));
      if(screen==0){vec2 cell=position.xy/layoutScalar(p+17);a=appearanceScreen(cell.x,cell.y);b=appearanceScreen(cell.x+3.0,cell.y+5.0);}
      else if(screen==1){int ix=inputIndex%8,iy=(inputIndex/8)%8;a=appearanceScreen(float(ix),float(iy));b=appearanceScreen(float(ix)+3.0,float(iy)+5.0);}
      int slot=(coverageA>=a?1:0)|(coverageB>b?2:0);
      appearanceTint(p+int(layoutScalar(p+18))+slot*6,layoutScalar(p+19),layoutScalar(p+20),tintRGB,tintAmount,tintPerceptual);
    }else if(kind==4){
      hue+=layoutScalar(p+14)+layoutScalar(p+15)*(position.x+position.y)*0.7071067811865476;
      if(layoutScalar(p+17)>0.0)appearanceTint(p+int(layoutScalar(p+16)),layoutScalar(p+17),layoutScalar(p+18),tintRGB,tintAmount,tintPerceptual);
    }else if(kind==5){
      appearanceNoteTimeline(position,p,inputIndex,hue,tintRGB,tintAmount,tintPerceptual);
    }
  }
`
