// RenderSpec: a serializable object-instrument description — a geometry primitive plus
// per-property expression bindings over the object's params and ports. The engine
// interprets it, so a new shape is DATA, not a hand-written R3F component (and later,
// something an LLM can emit for "design in English"). Expressions are a small, SAFE
// vocabulary — parsed to closures, never eval'd: numbers, `param.*` / `port.*` / `beat`
// refs, + - * / %, unary minus, parens, and a fixed set of math functions.

export type Primitive = 'box' | 'sphere' | 'plane' | 'tetrahedron' | 'cone' | 'circle'

/** An expression string, e.g. "param.baseSize * (1 + port.energy * 0.35)". */
export type Expr = string

export interface RenderSpec {
  primitive: Primitive
  /** Transform bindings — each defaults to identity (position 0, rotation 0, scale 1). */
  transform?: {
    position?: [Expr, Expr, Expr]
    rotation?: [Expr, Expr, Expr]
    scale?: Expr | [Expr, Expr, Expr]
  }
  /** Appearance bindings, applied to the material each frame. */
  appearance?: {
    hue?: Expr     // 0–360 → setHSL(hue/360, 0.65, 0.6)
    emissive?: Expr // emissiveIntensity
    opacity?: Expr // 0–1 (enables transparency)
  }
}

/** The values an expression reads. */
export interface Scope {
  param: Record<string, number>
  port: Record<string, number>
  beat: number
}

/** A compiled expression: parse once, evaluate cheaply every frame. */
export type Compiled = (s: Scope) => number

// The whole (safe) function vocabulary. Grow it as real specs demand — deliberately
// small to start (see the plan: don't design the grammar up front).
const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, abs: Math.abs, sign: Math.sign,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt,
  min: Math.min, max: Math.max, pow: Math.pow,
  clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
  mix: (a, b, t) => a + (b - a) * t,
}

const CONSTS: Record<string, number> = { pi: Math.PI, tau: Math.PI * 2 }

// ── tokenizer ──
interface Token { type: 'number' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma'; value: string }

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const isDigit = (c: string) => c >= '0' && c <= '9'
  const isIdent = (c: string) => /[a-zA-Z0-9_.]/.test(c)
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue }
    if (isDigit(c) || c === '.') {
      let j = i
      while (j < src.length && (isDigit(src[j]) || src[j] === '.')) j++
      tokens.push({ type: 'number', value: src.slice(i, j) }); i = j; continue
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i
      while (j < src.length && isIdent(src[j])) j++
      tokens.push({ type: 'ident', value: src.slice(i, j) }); i = j; continue
    }
    if ('+-*/%'.includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue }
    if (c === '(') { tokens.push({ type: 'lparen', value: c }); i++; continue }
    if (c === ')') { tokens.push({ type: 'rparen', value: c }); i++; continue }
    if (c === ',') { tokens.push({ type: 'comma', value: c }); i++; continue }
    throw new Error(`renderSpec: unexpected char '${c}' in "${src}"`)
  }
  return tokens
}

function compileVar(name: string): Compiled {
  if (name === 'beat') return (s) => s.beat
  if (name in CONSTS) { const v = CONSTS[name]; return () => v }
  if (name.startsWith('param.')) { const k = name.slice(6); return (s) => s.param[k] ?? 0 }
  if (name.startsWith('port.')) { const k = name.slice(5); return (s) => s.port[k] ?? 0 }
  throw new Error(`renderSpec: unknown identifier "${name}"`)
}

/** Parse an expression into a fast per-frame evaluator. Throws on malformed input. */
export function compileExpr(src: string): Compiled {
  const tokens = tokenize(src)
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  const parseExpr = (): Compiled => {
    let left = parseTerm()
    while (peek()?.type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value, r = parseTerm(), l = left
      left = op === '+' ? (s) => l(s) + r(s) : (s) => l(s) - r(s)
    }
    return left
  }
  const parseTerm = (): Compiled => {
    let left = parseFactor()
    while (peek()?.type === 'op' && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
      const op = next().value, r = parseFactor(), l = left
      left = op === '*' ? (s) => l(s) * r(s) : op === '/' ? (s) => l(s) / r(s) : (s) => l(s) % r(s)
    }
    return left
  }
  const parseFactor = (): Compiled => {
    if (peek()?.type === 'op' && peek().value === '-') { next(); const f = parseFactor(); return (s) => -f(s) }
    return parsePrimary()
  }
  const parsePrimary = (): Compiled => {
    const t = peek()
    if (!t) throw new Error(`renderSpec: unexpected end of "${src}"`)
    if (t.type === 'number') { next(); const v = Number(t.value); return () => v }
    if (t.type === 'lparen') { next(); const e = parseExpr(); if (next()?.type !== 'rparen') throw new Error(`renderSpec: missing ) in "${src}"`); return e }
    if (t.type === 'ident') {
      next()
      if (peek()?.type === 'lparen') {
        next()
        const args: Compiled[] = []
        if (peek()?.type !== 'rparen') {
          args.push(parseExpr())
          while (peek()?.type === 'comma') { next(); args.push(parseExpr()) }
        }
        if (next()?.type !== 'rparen') throw new Error(`renderSpec: missing ) after ${t.value}() in "${src}"`)
        const fn = FUNCS[t.value]
        if (!fn) throw new Error(`renderSpec: unknown function "${t.value}"`)
        return (s) => fn(...args.map((a) => a(s)))
      }
      return compileVar(t.value)
    }
    throw new Error(`renderSpec: unexpected token "${t.value}" in "${src}"`)
  }

  const root = parseExpr()
  if (pos < tokens.length) throw new Error(`renderSpec: trailing tokens in "${src}"`)
  return root
}
