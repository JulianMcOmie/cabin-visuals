export interface FontVariant {
  value: string; // e.g. "900 normal", "400 italic"
  label: string; // e.g. "Black", "Italic"
}

export const ALL_FONT_VARIANTS: FontVariant[] = [
  { value: '900 normal', label: 'Black' },
  { value: '700 normal', label: 'Bold' },
  { value: '400 normal', label: 'Regular' },
  { value: '900 italic', label: 'Black Italic' },
  { value: '700 italic', label: 'Bold Italic' },
  { value: '400 italic', label: 'Italic' },
];

export interface FontOption {
  value: string;
  label: string;
  category: string;
  googleFont?: boolean;
  // Which variants this font supports (subset of ALL_FONT_VARIANTS values).
  // System fonts use browser synthesis so all variants are available.
  variants?: string[];
}

// System fonts support all variants via browser synthesis
const SYSTEM_VARIANTS = ALL_FONT_VARIANTS.map((v) => v.value);

export const FONT_OPTIONS: FontOption[] = [
  // Bold / Display
  { value: 'Impact', label: 'Impact', category: 'display', variants: SYSTEM_VARIANTS },
  { value: 'Arial Black', label: 'Arial Black', category: 'display', variants: SYSTEM_VARIANTS },
  { value: 'Anton', label: 'Anton', category: 'display', googleFont: true, variants: ['400 normal'] },
  { value: 'Bebas Neue', label: 'Bebas Neue', category: 'display', googleFont: true, variants: ['400 normal'] },
  { value: 'Oswald', label: 'Oswald', category: 'display', googleFont: true, variants: ['400 normal', '700 normal'] },
  { value: 'Righteous', label: 'Righteous', category: 'display', googleFont: true, variants: ['400 normal'] },
  { value: 'Bungee', label: 'Bungee', category: 'display', googleFont: true, variants: ['400 normal'] },
  { value: 'Syne', label: 'Syne', category: 'display', googleFont: true,
    variants: ['400 normal', '700 normal'] },
  { value: 'Unbounded', label: 'Unbounded', category: 'display', googleFont: true,
    variants: ['400 normal', '700 normal', '900 normal'] },

  // Editorial / High-contrast Serif
  { value: 'Bodoni Moda', label: 'Bodoni Moda', category: 'serif', googleFont: true,
    variants: ['400 normal', '700 normal', '900 normal', '400 italic', '700 italic', '900 italic'] },
  { value: 'Cormorant Garamond', label: 'Cormorant Garamond', category: 'serif', googleFont: true,
    variants: ['400 normal', '700 normal', '400 italic', '700 italic'] },
  { value: 'Cormorant', label: 'Cormorant', category: 'serif', googleFont: true,
    variants: ['400 normal', '700 normal', '400 italic', '700 italic'] },
  { value: 'DM Serif Display', label: 'DM Serif Display', category: 'serif', googleFont: true,
    variants: ['400 normal', '400 italic'] },
  { value: 'Instrument Serif', label: 'Instrument Serif', category: 'serif', googleFont: true,
    variants: ['400 normal', '400 italic'] },
  { value: 'Fraunces', label: 'Fraunces', category: 'serif', googleFont: true,
    variants: ['400 normal', '700 normal', '900 normal', '400 italic', '700 italic', '900 italic'] },
  { value: 'Libre Baskerville', label: 'Libre Baskerville', category: 'serif', googleFont: true,
    variants: ['400 normal', '700 normal', '400 italic'] },
  { value: 'EB Garamond', label: 'EB Garamond', category: 'serif', googleFont: true,
    variants: ['400 normal', '700 normal', '400 italic', '700 italic'] },
  { value: 'Cinzel', label: 'Cinzel', category: 'serif', googleFont: true,
    variants: ['400 normal', '700 normal', '900 normal'] },
  { value: 'Cinzel Decorative', label: 'Cinzel Decorative', category: 'serif', googleFont: true,
    variants: ['400 normal', '700 normal', '900 normal'] },
  { value: 'Spectral', label: 'Spectral', category: 'serif', googleFont: true,
    variants: ['400 normal', '700 normal', '400 italic', '700 italic'] },
  { value: 'Lora', label: 'Lora', category: 'serif', googleFont: true,
    variants: ['400 normal', '700 normal', '400 italic', '700 italic'] },
  { value: 'Source Serif 4', label: 'Source Serif 4', category: 'serif', googleFont: true,
    variants: ['400 normal', '700 normal', '900 normal', '400 italic', '700 italic', '900 italic'] },
  { value: 'Italiana', label: 'Italiana', category: 'serif', googleFont: true,
    variants: ['400 normal'] },

  // Script / Decorative
  { value: 'Pacifico', label: 'Pacifico', category: 'script', googleFont: true, variants: ['400 normal'] },
  { value: 'Permanent Marker', label: 'Permanent Marker', category: 'marker', googleFont: true, variants: ['400 normal'] },
  { value: 'Lobster', label: 'Lobster', category: 'script', googleFont: true, variants: ['400 normal'] },
  { value: 'Bangers', label: 'Bangers', category: 'comic', googleFont: true, variants: ['400 normal'] },
  { value: 'Comic Sans MS', label: 'Comic Sans MS', category: 'comic', variants: SYSTEM_VARIANTS },

  // Serif (classic)
  { value: 'Playfair Display', label: 'Playfair Display', category: 'serif', googleFont: true,
    variants: ['400 normal', '700 normal', '900 normal', '400 italic', '700 italic', '900 italic'] },
  { value: 'Abril Fatface', label: 'Abril Fatface', category: 'serif', googleFont: true, variants: ['400 normal'] },
  { value: 'Georgia', label: 'Georgia', category: 'serif', variants: SYSTEM_VARIANTS },
  { value: 'Times New Roman', label: 'Times New Roman', category: 'serif', variants: SYSTEM_VARIANTS },

  // Modern Sans
  { value: 'Space Grotesk', label: 'Space Grotesk', category: 'sans', googleFont: true,
    variants: ['400 normal', '700 normal'] },
  { value: 'Outfit', label: 'Outfit', category: 'sans', googleFont: true,
    variants: ['400 normal', '700 normal', '900 normal'] },
  { value: 'Plus Jakarta Sans', label: 'Plus Jakarta Sans', category: 'sans', googleFont: true,
    variants: ['400 normal', '700 normal', '400 italic', '700 italic'] },
  { value: 'DM Sans', label: 'DM Sans', category: 'sans', googleFont: true,
    variants: ['400 normal', '700 normal', '400 italic', '700 italic'] },

  // Monospace
  { value: 'Space Mono', label: 'Space Mono', category: 'mono', googleFont: true,
    variants: ['400 normal', '700 normal', '400 italic', '700 italic'] },
  { value: 'JetBrains Mono', label: 'JetBrains Mono', category: 'mono', googleFont: true,
    variants: ['400 normal', '700 normal', '400 italic', '700 italic'] },
  { value: 'Courier New', label: 'Courier New', category: 'mono', variants: SYSTEM_VARIANTS },

  // Sans (system)
  { value: 'Verdana', label: 'Verdana', category: 'sans', variants: SYSTEM_VARIANTS },
  { value: 'Trebuchet MS', label: 'Trebuchet MS', category: 'sans', variants: SYSTEM_VARIANTS },
];

export function getAvailableVariants(fontFamily: string): FontVariant[] {
  const font = FONT_OPTIONS.find((f) => f.value === fontFamily);
  if (!font?.variants) return ALL_FONT_VARIANTS;
  return ALL_FONT_VARIANTS.filter((v) => font.variants!.includes(v.value));
}

const loadedFonts = new Set<string>();
const readyFonts = new Set<string>();
let linkElement: HTMLLinkElement | null = null;

function updateGoogleFontsLink(): void {
  const googleFonts = Array.from(loadedFonts);
  if (googleFonts.length === 0) return;

  const families = googleFonts
    .map((f) => {
      const font = FONT_OPTIONS.find((fo) => fo.value === f);
      const variants = font?.variants ?? ALL_FONT_VARIANTS.map((v) => v.value);
      // Build ital,wght axis tuples: "0,400;0,700;1,400" etc.
      const hasItalic = variants.some((v) => v.endsWith('italic'));
      const tuples = variants.map((v) => {
        const [weight, style] = v.split(' ');
        return hasItalic ? `${style === 'italic' ? 1 : 0},${weight}` : weight;
      });
      const axis = hasItalic ? 'ital,wght' : 'wght';
      return `family=${f.replace(/ /g, '+')}:${axis}@${tuples.join(';')}`;
    })
    .join('&');
  const href = `https://fonts.googleapis.com/css2?${families}&display=swap`;

  if (!linkElement) {
    linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    document.head.appendChild(linkElement);
  }
  linkElement.href = href;
}

export function loadFont(fontFamily: string): void {
  const font = FONT_OPTIONS.find((f) => f.value === fontFamily);
  if (!font?.googleFont || loadedFonts.has(fontFamily)) return;
  loadedFonts.add(fontFamily);
  updateGoogleFontsLink();

  // Poll with document.fonts.load() for each supported variant to detect
  // when each weight/style combo is truly usable for canvas rendering.
  const variants = font.variants ?? ALL_FONT_VARIANTS.map((v) => v.value);
  for (const variant of variants) {
    const [weight, style] = variant.split(' ');
    const fontSpec = `${style === 'italic' ? 'italic ' : ''}${weight} 48px "${fontFamily}"`;
    const key = `${fontFamily}|${variant}`;

    const waitForVariant = () => {
      document.fonts.load(fontSpec).then((faces) => {
        if (faces.length > 0) {
          readyFonts.add(key);
        } else {
          requestAnimationFrame(waitForVariant);
        }
      });
    };
    requestAnimationFrame(waitForVariant);
  }
}

/**
 * Returns true if the font+variant is available for canvas rendering.
 * For system fonts this is always true; for Google Fonts it checks
 * whether the specific weight/style has finished downloading.
 */
export function isFontReady(fontFamily: string, variant: string = '900 normal'): boolean {
  const font = FONT_OPTIONS.find((f) => f.value === fontFamily);
  if (!font?.googleFont) return true; // system font, always available
  return readyFonts.has(`${fontFamily}|${variant}`);
}

export function loadAllFonts(): void {
  FONT_OPTIONS.forEach((f) => {
    if (f.googleFont) loadFont(f.value);
  });
}
