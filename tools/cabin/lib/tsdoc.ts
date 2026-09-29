import ts from 'typescript'
import path from 'path'
import { REPO } from './paths'

// Reference docs generated from the source with the TypeScript compiler, so
// they can't go stale: `cabin docs sdk` / `cabin docs api <name>` (the code-
// instrument SDK's exports) and `cabin actions` (the editor store's actions).

export interface DocEntry {
  name: string
  kind: 'function' | 'interface' | 'type' | 'const' | 'class' | 'enum' | 'method' | 'namespace'
  /** The declaration without its body. */
  signature: string
  doc: string
  /** repo-relative file:line */
  where: string
}

function program(entry: string): ts.Program {
  return ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve, skipLibCheck: true, noEmit: true, allowJs: false, strict: true,
    baseUrl: REPO, paths: { '@/*': ['src/*'] },
  })
}

const squash = (s: string) => s.replace(/\n\s*/g, '\n  ').replace(/\s+$/, '')

function where(node: ts.Node): string {
  const sf = node.getSourceFile()
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
  return `${path.relative(REPO, sf.fileName)}:${line + 1}`
}

function docOf(symbol: ts.Symbol, checker: ts.TypeChecker): string {
  return ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim()
}

function signatureOf(decl: ts.Declaration, name: string, checker: ts.TypeChecker): { kind: DocEntry['kind']; signature: string } {
  const text = decl.getText()
  if (ts.isFunctionDeclaration(decl)) {
    const body = decl.body ? text.slice(0, decl.body.getStart() - decl.getStart()) : text
    return { kind: 'function', signature: squash(body.replace(/^export\s+/, '').trim()) }
  }
  if (ts.isInterfaceDeclaration(decl)) return { kind: 'interface', signature: squash(text.replace(/^export\s+/, '')) }
  if (ts.isTypeAliasDeclaration(decl)) return { kind: 'type', signature: squash(text.replace(/^export\s+/, '')) }
  if (ts.isEnumDeclaration(decl)) return { kind: 'enum', signature: squash(text.replace(/^export\s+/, '')) }
  if (ts.isClassDeclaration(decl)) {
    const members = decl.members
      .filter((m) => !(ts.getCombinedModifierFlags(m as ts.Declaration) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) && !m.name?.getText().startsWith('#'))
      .map((m) => {
        const t = m.getText()
        const bodyAt = (ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m) || ts.isGetAccessor(m)) && m.body ? m.body.getStart() - m.getStart() : t.length
        return '  ' + t.slice(0, bodyAt).replace(/\s+/g, ' ').trim()
      })
    return { kind: 'class', signature: `class ${name} {\n${members.join('\n')}\n}` }
  }
  if (ts.isVariableDeclaration(decl)) {
    const type = checker.typeToString(checker.getTypeAtLocation(decl), decl, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType)
    return { kind: 'const', signature: `const ${name}: ${type}` }
  }
  if (ts.isModuleDeclaration(decl) || ts.isSourceFile(decl)) return { kind: 'namespace', signature: `namespace ${name}` }
  return { kind: 'const', signature: squash(text) }
}

/** Every export of a module (following re-exports), in declaration order. */
export function moduleExports(entryRel: string): DocEntry[] {
  const entry = path.join(REPO, entryRel)
  const prog = program(entry)
  const checker = prog.getTypeChecker()
  const sf = prog.getSourceFile(entry)
  if (!sf) throw new Error(`can't read ${entryRel}`)
  const mod = checker.getSymbolAtLocation(sf)
  if (!mod) return []
  const out: DocEntry[] = []
  for (const exp of checker.getExportsOfModule(mod)) {
    const sym = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp
    const decl = sym.declarations?.[0]
    if (!decl) continue
    if (ts.isSourceFile(decl) || ts.isModuleDeclaration(decl)) {
      out.push({ name: exp.name, kind: 'namespace', signature: `namespace ${exp.name} (${path.relative(REPO, decl.getSourceFile().fileName)})`, doc: '', where: where(decl) })
      continue
    }
    const { kind, signature } = signatureOf(decl, exp.name, checker)
    out.push({ name: exp.name, kind, signature, doc: docOf(sym, checker) || leadingComment(decl), where: where(decl) })
  }
  return out.sort((a, b) => a.where.localeCompare(b.where, undefined, { numeric: true }))
}

/** The members of an interface (e.g. a zustand store's state + actions). */
export function interfaceMembers(fileRel: string, iface: string, onlyMethods = false): DocEntry[] {
  const file = path.join(REPO, fileRel)
  const prog = program(file)
  const checker = prog.getTypeChecker()
  const sf = prog.getSourceFile(file)
  if (!sf) throw new Error(`can't read ${fileRel}`)
  let decl: ts.InterfaceDeclaration | undefined
  sf.forEachChild((n) => { if (ts.isInterfaceDeclaration(n) && n.name.text === iface) decl = n })
  if (!decl) throw new Error(`no interface ${iface} in ${fileRel}`)
  const out: DocEntry[] = []
  for (const m of decl.members) {
    const name = m.name?.getText() ?? '?'
    const isMethod = ts.isMethodSignature(m) || (ts.isPropertySignature(m) && !!m.type && ts.isFunctionTypeNode(m.type))
    if (onlyMethods && !isMethod) continue
    const sym = m.name ? checker.getSymbolAtLocation(m.name) : undefined
    out.push({ name, kind: isMethod ? 'method' : 'const', signature: m.getText().replace(/\s+/g, ' ').replace(/;$/, ''), doc: sym ? docOf(sym, checker) : '', where: where(m) })
  }
  return out
}

/** A `//` comment block directly above a declaration (the codebase's usual style). */
function leadingComment(node: ts.Node): string {
  const sf = node.getSourceFile()
  const full = sf.getFullText()
  const ranges = ts.getLeadingCommentRanges(full, node.getFullStart()) ?? []
  return ranges
    .map((r) => full.slice(r.pos, r.end).replace(/^\/\/ ?|^\/\*\*?|\*\/$/g, '').replace(/\n\s*\* ?/g, '\n').trim())
    .filter((c) => !/^-{4,}/.test(c)) // section dividers aren't docs
    .join('\n').trim()
}
