import { Resvg } from '@resvg/resvg-js';
import type { VisualElement } from './model.js';

type TextElement = Extract<VisualElement, { type: 'text' }>;
export const escapeXml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const cache = new Map<string, TextLayout>();
type TextLayout = { lines: string[]; fontSize: number; width: number; height: number; relativeTop: number; overflow: boolean };

function bbox(text: string, e: TextElement, size: number, line = 0) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8192" height="8192"><text x="1000" y="${1000 + line * size * e.lineHeight}" font-family="${escapeXml(e.fontFamily)}" font-size="${size}" font-weight="${e.fontWeight}" letter-spacing="${e.letterSpacing}">${escapeXml(text || ' ')}</text></svg>`;
  return new Resvg(svg).getBBox();
}
function layoutAt(e: TextElement, size: number): TextLayout {
  const maxWidth = e.width ?? Infinity;
  const lines: string[] = [];
  for (const sourceLine of e.text.split('\n')) {
    if (e.wrap !== 'word' || !Number.isFinite(maxWidth)) { lines.push(sourceLine); continue; }
    let current = '';
    for (const word of sourceLine.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && (bbox(candidate, e, size)?.width ?? 0) > maxWidth) { lines.push(current); current = word; }
      else current = candidate;
    }
    lines.push(current);
  }
  const boxes = lines.map((line, i) => bbox(line, e, size, i));
  const width = Math.max(0, ...boxes.map(box => box?.width ?? 0));
  const top = Math.min(...boxes.map(box => box?.y ?? 1000)) - 1000;
  const bottom = Math.max(...boxes.map(box => (box?.y ?? 1000) + (box?.height ?? 0))) - 1000;
  return { lines, fontSize: size, width, height: bottom - top, relativeTop: top, overflow: width > maxWidth + 0.5 || (e.height !== undefined && bottom - top > e.height + 0.5) };
}
export function textLayout(e: TextElement): TextLayout {
  const key = JSON.stringify([e.text, e.fontFamily, e.fontSize, e.fontWeight, e.letterSpacing, e.lineHeight, e.width, e.height, e.wrap, e.fit, e.minFontSize]);
  const previous = cache.get(key);
  if (previous) return previous;
  let result = layoutAt(e, e.fontSize);
  if (e.fit === 'shrink' && result.overflow) {
    const minimum = e.minFontSize ?? Math.max(12, e.fontSize * 0.5);
    let low = minimum, high = e.fontSize;
    result = layoutAt(e, low);
    if (!result.overflow) {
      for (let i = 0; i < 10; i++) {
        const middle = (low + high) / 2;
        const candidate = layoutAt(e, middle);
        if (candidate.overflow) high = middle;
        else { low = middle; result = candidate; }
      }
    }
  }
  cache.set(key, result);
  return result;
}
export function textPosition(e: TextElement, layout = textLayout(e)) {
  const x = e.x + (e.align === 'middle' ? (e.width ?? 0) / 2 : e.align === 'end' ? (e.width ?? 0) : 0);
  const vertical = e.height === undefined || !e.verticalAlign ? 0 : e.verticalAlign === 'middle' ? (e.height - layout.height) / 2 : e.verticalAlign === 'bottom' ? e.height - layout.height : 0;
  const baseline = e.y + (e.verticalAlign && e.height !== undefined ? vertical - layout.relativeTop : 0);
  return { x, baseline, left: x - (e.align === 'middle' ? layout.width / 2 : e.align === 'end' ? layout.width : 0), top: baseline + layout.relativeTop };
}
export function textNode(e: TextElement, opacity: number, dy: number, color: string): string {
  const layout = textLayout(e);
  const pos = textPosition(e, layout);
  const anchor = e.align === 'middle' ? 'middle' : e.align === 'end' ? 'end' : 'start';
  const tspans = layout.lines.map((line, i) => `<tspan x="${pos.x}" y="${pos.baseline + dy + i * layout.fontSize * e.lineHeight}">${escapeXml(line)}</tspan>`).join('');
  return `<text font-family="${escapeXml(e.fontFamily)}" font-size="${layout.fontSize}" font-weight="${e.fontWeight}" letter-spacing="${e.letterSpacing}" text-anchor="${anchor}" fill="${color}" opacity="${opacity}">${tspans}</text>`;
}
