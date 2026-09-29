import fs from 'fs'
import path from 'path'
import { CUSTOM } from './paths'

// `cabin instrument new <pack>/<name> [--kind ...]`: write a starting file for a
// code instrument or composition. The dev server's watcher (and the CLI, right
// after writing) registers it - there is no other step.

export type ScaffoldKind = 'strokes' | 'particles' | 'mesh' | 'fullframe' | 'post' | 'camera' | 'composition'

const title = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

function body(kind: ScaffoldKind, id: string, name: string): string {
  const head = (imports: string) => `import * as THREE from 'three'\nimport { ${imports} } from '../../code'\n`
  switch (kind) {
    case 'strokes':
      return `${head('defineInstrument, p, Strokes, Sprites, SPRITE, ease, tween')}
// ${name}: TODO one line - what it looks like, what each row does.
// Its own notes: ctx.hits / last / held / next / upcoming / pulse (the future
// too). Another track's: ctx.lane('Kick') - the same queries. Edit and save:
// the running editor swaps the new code in on the next frame.

export const instrument = defineInstrument({
  id: '${id}',
  name: '${name}',
  description: 'TODO',
  color: '#7dd3fc',
  params: {
    size: p.num(1.5, 0.1, 6),
    color: p.color('#7dd3fc'),
  },
  rows: {
    60: 'Hit',
  },
  setup(ctx) {
    const lines = ctx.own(new Strokes(4096, { glow: 1.2 }))
    const dots = ctx.own(new Sprites(1024))
    ctx.root.add(lines, dots)
    return { lines, dots, tmp: new THREE.Color() }
  },
  frame(ctx, s) {
    s.lines.begin()
    s.dots.begin()
    for (const h of ctx.hits(60, 2)) {
      const k = tween(h.age, 0, 2, ease.expo.out)
      s.lines.ring(0, 0, 0, ctx.params.size * (0.2 + k), 0.01, ctx.colors.color, (1 - k) * h.velocity, 2.5)
    }
    s.dots.put(0, 0, 0, 0.05 + 0.1 * ctx.pulse(60, 0.25), SPRITE.flare, ctx.colors.color, 1, 2)
    s.lines.end()
    s.dots.end()
  },
})
`
    case 'particles':
      return `${head('defineInstrument, p, particles')}
// ${name}: TODO one line. Every particle's position is computed in the vertex
// shader from its seed + uniforms, so 100k+ motes cost one draw.

export const instrument = defineInstrument({
  id: '${id}',
  name: '${name}',
  description: 'TODO',
  color: '#ffd08a',
  params: {
    count: p.int(60000, 1000, 300000),
    spread: p.num(2, 0.1, 8),
    color: p.color('#ffd08a'),
  },
  rows: { 60: 'Burst' },
  setup(ctx) {
    const cloud = ctx.own(particles({
      count: Math.round(ctx.params.count),
      uniforms: { uBurst: { value: 0 }, uSpread: { value: 2 }, uColor: { value: new THREE.Color() } },
      header: 'uniform float uBurst, uSpread; uniform vec3 uColor;',
      vertex: \`
        vec3 dir = normalize(aSeed.xyz * 2.0 - 1.0 + 1e-4);
        float r = uSpread * pow(aSeed.w, 0.5) * (1.0 + uBurst * aSeed.x);
        pos = dir * r + snoise3(dir * 2.0 + uSec * 0.2) * 0.1;
        size = 2.0 + uBurst * 3.0;
        color = vec4(uColor * (1.0 + uBurst * 2.0), 0.6);\`,
    }))
    ctx.root.add(cloud)
    return { cloud }
  },
  frame(ctx, s) {
    s.cloud.tick(ctx.beat, ctx.sec, ctx.px)
    s.cloud.u('uBurst').value = ctx.pulse(60, 0.4)
    s.cloud.u('uSpread').value = ctx.params.spread
    ;(s.cloud.u('uColor').value as THREE.Color).copy(ctx.colors.color)
  },
})
`
    case 'mesh':
      return `${head('defineInstrument, p, spring')}
// ${name}: TODO one line. Plain three.js meshes, lit by the scene's Light tracks.

export const instrument = defineInstrument({
  id: '${id}',
  name: '${name}',
  description: 'TODO',
  color: '#a78bfa',
  castsShadows: true,
  params: { color: p.color('#a78bfa'), roughness: p.num(0.3, 0, 1) },
  rows: { 60: 'Flip' },
  setup(ctx) {
    const mat = ctx.own(new THREE.MeshStandardMaterial({ color: '#a78bfa', roughness: 0.3, metalness: 0.2 }))
    const geo = ctx.own(new THREE.IcosahedronGeometry(1, 0))
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    ctx.root.add(mesh)
    return { mesh, mat }
  },
  frame(ctx, s) {
    s.mat.color.copy(ctx.colors.color)
    s.mat.roughness = ctx.params.roughness
    // a quarter turn per note, springing into place - summed over every note so far
    let turn = 0
    for (const h of ctx.hits(60)) turn += (Math.PI / 2) * spring(h.ageSec, { freq: 2.5, damping: 0.45 })
    s.mesh.rotation.set(turn * 0.5, turn, 0)
  },
})
`
    case 'fullframe':
      return `${head('defineInstrument, p, GLSL')}
// ${name}: TODO one line. A full-frame shader plane (backdrops, fields, washes).

export const instrument = defineInstrument({
  id: '${id}',
  name: '${name}',
  description: 'TODO',
  color: '#22d3ee',
  fullFrame: true,
  params: { a: p.color('#0b1030'), b: p.color('#22d3ee') },
  rows: { 60: 'Flash' },
  setup(ctx) {
    const mat = ctx.own(new THREE.ShaderMaterial({
      uniforms: { uBeat: { value: 0 }, uFlash: { value: 0 }, uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uOpacity: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: \`
        uniform float uBeat, uFlash, uOpacity; uniform vec3 uA, uB; varying vec2 vUv;
        \${GLSL.noise}
        void main(){
          float n = fbm(vec3(vUv * 3.0, uBeat * 0.1));
          vec3 c = mix(uA, uB, smoothstep(-0.2, 0.6, n)) + uFlash;
          gl_FragColor = vec4(c, uOpacity);
        }\`,
      depthWrite: false,
    }))
    const plane = new THREE.Mesh(ctx.own(new THREE.PlaneGeometry(1, 1)), mat)
    ctx.root.add(plane)
    return { plane, mat }
  },
  frame(ctx, s) {
    s.plane.scale.set(ctx.viewport.width, ctx.viewport.height, 1)
    s.mat.uniforms.uBeat.value = ctx.beat
    s.mat.uniforms.uFlash.value = ctx.pulse(60, 0.25) * 0.5
    ;(s.mat.uniforms.uA.value as THREE.Color).copy(ctx.colors.a)
    ;(s.mat.uniforms.uB.value as THREE.Color).copy(ctx.colors.b)
  },
})
`
    case 'post':
      return `import { defineInstrument, p } from '../../code'

// ${name}: TODO one line. A scene post pass played by MIDI: it draws nothing
// itself and reshapes the finished scene (tDiffuse) while its rows are active.

export const instrument = defineInstrument({
  id: '${id}',
  name: '${name}',
  description: 'TODO',
  color: '#f472b6',
  params: { amount: p.num(1, 0, 2) },
  rows: { 60: 'Hit' },
  post: {
    // Pre-declared for you: tDiffuse, vUv, uAspect, uBeat, uResolution (+ your uniforms).
    fragment: \`
      uniform float uAmount;
      void main(){
        vec2 d = vUv - 0.5;
        float k = uAmount * 0.02;
        vec3 c = vec3(texture2D(tDiffuse, vUv + d * k).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d * k).b);
        gl_FragColor = vec4(c, texture2D(tDiffuse, vUv).a);
      }\`,
    uniforms: { uAmount: { value: 0 } },
    update(ctx, u) {
      const amount = ctx.pulse(60, 0.3) * ctx.params.amount
      if (amount < 0.001) return false
      u.uAmount.value = amount
    },
  },
})
`
    case 'camera':
      return `import { defineInstrument, p, clamp, ease, lerp } from '../../code'

// ${name}: flies THE camera (one camera, shared by every scene) and grades the
// frame while its scene is on screen - handed back (default pose) when the
// scene cuts away. Reads the song's shared lanes (\`cabin lanes <project>
// --from-analysis\`) so one Kick lane drives it and everything else.

export const instrument = defineInstrument({
  id: '${id}',
  name: '${name}',
  description: 'TODO: how the camera moves, what the look does on hits.',
  color: '#f472b6',
  params: {
    distance: p.num(5, 1, 20),
    orbit: p.num(0.1, -1, 1, { label: 'Orbit (rev/bar)' }),
    push: p.num(0.8, 0, 4, { label: 'Kick push' }),
    kick: p.text('Kick', { label: 'Kick lane' }),
  },
  camera(ctx) {
    const k = clamp(ctx.lane(ctx.text.kick).pulse(undefined, 0.3))
    const a = ctx.bar * ctx.params.orbit * Math.PI * 2
    const d = ctx.params.distance - ctx.params.push * k
    return { position: [Math.sin(a) * d, 0.4, Math.cos(a) * d], target: [0, 0, 0], fov: lerp(55, 62, ease.expo.out(k)) }
  },
  look(ctx) {
    const k = clamp(ctx.lane(ctx.text.kick).pulse(undefined, 0.25))
    return { bloom: 0.9 + 0.6 * k, aberration: 4 * k }
  },
})
`
    case 'composition':
      return `import { defineComposition, p, ease, clamp } from '../../code'

// ${name}: TODO one line. A Composite-scene composition: its scene rows pick
// what is on screen; the transition between two picks is choreographed below.

export const composition = defineComposition({
  id: '${id}',
  name: '${name}',
  description: 'TODO',
  params: { beats: p.num(2, 0.25, 8, { label: 'Transition (beats)' }) },
  resolve(ctx) {
    // the newest scene onset wins; the one before it is where we came from
    const cuts = ctx.hits((pitch) => !!ctx.scene(pitch))
    const now = cuts[0]
    if (!now) return ctx.scenes[0] ? [ctx.layer(ctx.scenes[0].sceneId)] : []
    const to = ctx.scene(now.pitch)!.sceneId
    const prev = cuts[1] ? ctx.scene(cuts[1].pitch)!.sceneId : null
    const k = ease.cubic.inOut(clamp(now.age / ctx.params.beats))
    if (!prev || k >= 1 || prev === to) return [ctx.layer(to)]
    // zoom out of the old scene while the new one irises open from the centre
    return [
      ctx.shaded(prev, { key: '${id}:out', fragment: \`
        uniform float uK;
        void main(){ vec2 d = vUv - 0.5; vec4 c = texture2D(tScene, 0.5 + d / (1.0 + uK * 3.0)); gl_FragColor = vec4(c.rgb, uOpacity); }\`,
        uniforms: { uK: k } }),
      ctx.shaded(to, { key: '${id}:in', fragment: \`
        uniform float uK;
        void main(){ vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0); float r = length(p);
          float m = smoothstep(uK * 1.2, uK * 1.2 - 0.01, r);
          gl_FragColor = vec4(texture2D(tScene, vUv).rgb, m * uOpacity); }\`,
        uniforms: { uK: k } }),
    ]
  },
})
`
  }
}

export function scaffold(spec: string, kind: ScaffoldKind): string {
  const m = /^([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/.exec(spec)
  if (!m) throw new Error(`name it <pack>/<name> in lowercase-kebab (e.g. innuendo/chladni), got "${spec}"`)
  const [, pack, name] = m
  const file = path.join(CUSTOM, pack, `${name}.ts`)
  if (fs.existsSync(file)) throw new Error(`${file} already exists`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body(kind, `${pack}.${name}`, title(name)))
  return file
}
