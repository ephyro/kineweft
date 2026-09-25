import type { Project } from './model.js';
import { resolveColor, type Drawable } from './renderer.js';
import { textLayout, textPosition } from './text.js';

type Rgb = [number, number, number];
export type ColorIssue = { id: string; time: number; kind: 'contrast'; message: string };
const rgb = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
const blend = (front: Rgb, back: Rgb, alpha: number): Rgb => front.map((channel, i) => channel * alpha + back[i]! * (1 - alpha)) as Rgb;
function luminance(color: Rgb) {
  const [r, g, b] = color.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
}
export function contrastRatio(a: string, b: string) {
  const x = luminance(rgb(a)), y = luminance(rgb(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function ratio(a: Rgb, b: Rgb) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function inside(x: number, y: number, item: Drawable) {
  const e = item.element;
  if (e.type === 'text') return false;
  return x >= item.x && x <= item.x + e.width && y >= item.y + item.dy && y <= item.y + item.dy + e.height;
}
function backdrop(project: Project, items: Drawable[], before: number, x: number, y: number): Rgb | undefined {
  let color: Rgb | undefined = rgb(resolveColor(project, project.composition.background));
  for (let i = 0; i < before; i++) {
    const item = items[i]!;
    if (item.element.type === 'text' || !inside(x, y, item)) continue;
    if (item.element.type === 'image') { color = undefined; continue; }
    const foreground = rgb(resolveColor(project, item.element.color));
    color = item.opacity >= 0.999 ? foreground : color ? blend(foreground, color, item.opacity) : undefined;
  }
  return color;
}
export function colorIssuesAt(project: Project, items: Drawable[], time: number): ColorIssue[] {
  const issues: ColorIssue[] = [];
  const minText = project.quality?.minTextContrast ?? 4.5;
  const minLarge = project.quality?.minLargeTextContrast ?? 3;
  const minSurface = project.quality?.minSurfaceContrast ?? 1.4;
  for (const [i, item] of items.entries()) {
    const e = item.element;
    if (e.type === 'image') continue;
    if (item.opacity < item.nominalOpacity * 0.95) continue;
    if (e.type === 'rect') {
      if (e.width < 32 || e.height < 32) continue;
      const bg = backdrop(project, items, i, item.x + e.width / 2, item.y + item.dy + e.height / 2);
      if (!bg) continue;
      const value = ratio(blend(rgb(resolveColor(project, e.color)), bg, item.opacity), bg);
      if (value < minSurface) issues.push({ id: e.id, time, kind: 'contrast', message: `Surface blends into its backdrop (${value.toFixed(2)}:1; target ${minSurface.toFixed(2)}:1)` });
      continue;
    }
    const font = e.fontFamily.startsWith('$') ? project.tokens!.fonts![e.fontFamily.slice(1)]! : e.fontFamily;
    const measured = { ...e, fontFamily: font };
    const layout = textLayout(measured);
    const pos = textPosition({ ...measured, x: item.x, y: item.y + item.dy }, layout);
    if (layout.width < 1 || layout.height < 1) continue;
    const y = pos.top + layout.height / 2;
    const points = [0.1, 0.5, 0.9].map(f => pos.left + layout.width * f);
    const values = points.map(x => {
      const bg = backdrop(project, items, i, x, y);
      return bg ? ratio(blend(rgb(resolveColor(project, e.color)), bg, item.opacity), bg) : undefined;
    }).filter((value): value is number => value !== undefined);
    if (!values.length) continue;
    const value = Math.min(...values);
    const minimum = layout.fontSize >= 24 || (layout.fontSize >= 18.67 && e.fontWeight >= 700) ? minLarge : minText;
    if (value < minimum) issues.push({ id: e.id, time, kind: 'contrast', message: `Text blends into its backdrop (${value.toFixed(2)}:1; target ${minimum.toFixed(2)}:1)` });
  }
  for (const caption of project.captions ?? []) {
    if (time < caption.start || time >= caption.end) continue;
    const underlying = backdrop(project, items, items.length, project.composition.width / 2, project.composition.height * 0.83);
    if (!underlying) continue;
    const bg = blend(rgb(resolveColor(project, caption.background)), underlying, 0.88);
    const value = ratio(rgb(resolveColor(project, caption.color)), bg);
    const minimum = caption.fontSize >= 24 ? minLarge : minText;
    if (value < minimum) issues.push({ id: caption.id, time, kind: 'contrast', message: `Caption blends into its background (${value.toFixed(2)}:1; target ${minimum.toFixed(2)}:1)` });
  }
  return issues;
}
