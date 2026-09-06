// Shared by GLSL declarations and runtime setters; mismatched names fail silently.

/** `facets` becomes `uKFacets`; with a suffix, `uKFacets_a1b2`. */
export function uniformName(key: string, suffix = ''): string {
  return `uK${key.charAt(0).toUpperCase()}${key.slice(1)}${suffix}`
}

/** A per-INSTANCE suffix, for plugins that stack within one program (deformers)
 *  and therefore cannot share a uniform namespace. An EffectInstance id is a
 *  nanoid, which may contain characters GLSL will not accept in an identifier
 *  and may begin with a digit; the leading underscore fixes both. */
export function instanceSuffix(instanceId: string): string {
  return `_${instanceId.replace(/[^A-Za-z0-9]/g, '_')}`
}
