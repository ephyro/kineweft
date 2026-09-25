import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import type { Element, Project, VisualElement } from './model.js';
import { escapeXml, textNode } from './text.js';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
function ease(value: number, easing: 'linear' | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic') {
  const p = clamp(value);
  if (easing === 'easeInCubic') return p * p * p;
  if (easing === 'easeOutCubic') return 1 - Math.pow(1 - p, 3);
  if (easing === 'easeInOutCubic') return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  return p;
}
function state(e: Element, t: number) {
  if (t < e.start || t >= e.end) return { opacity: 0, dy: 0 };
  const entrance = e.animation ? ease((t - e.start) / e.animation.duration, e.animation.easing) : 1;
  const exitElapsed = e.exitAnimation ? clamp((t - (e.end - e.exitAnimation.duration)) / e.exitAnimation.duration) : 0;
  const leaving = e.exitAnimation ? ease(exitElapsed, e.exitAnimation.easing) : 0;
  return { opacity: e.opacity * entrance * (1 - leaving), dy: (e.animation?.type === 'rise' ? (1 - entrance) * 32 : 0) - (e.exitAnimation?.type === 'rise' ? leaving * 24 : 0) };
}
export function resolveColor(project: Project, value: string): string {
  return value.startsWith('$') ? project.tokens!.colors![value.slice(1)]! : value;
}
export type Drawable = { element: VisualElement; x: number; y: number; opacity: number; nominalOpacity: number; dy: number };
export function drawablesAt(project: Project, time: number): Drawable[] {
  const out: Drawable[] = [];
  const visit = (e: Element, localTime: number, ox: number, oy: number, inheritedOpacity = 1, nominalOpacity = 1) => {
    const s = state(e, localTime);
    if (!s.opacity || !inheritedOpacity) return;
    if (e.type === 'component') {
      for (const child of project.components?.[e.name] ?? []) visit(child, localTime - e.start, ox + e.x, oy + e.y + s.dy, inheritedOpacity * s.opacity, nominalOpacity * e.opacity);
    } else out.push({ element: e, x: ox + e.x, y: oy + e.y, opacity: inheritedOpacity * s.opacity, nominalOpacity: nominalOpacity * e.opacity, dy: s.dy });
  };
  project.elements.forEach(e => visit(e, time, 0, 0));
  project.scenes?.forEach(scene => {
    if (time >= scene.start && time < scene.start + scene.duration) scene.elements.forEach(e => visit(e, time - scene.start, 0, 0));
  });
  return out;
}
export async function safeAsset(root: string, src: string): Promise<string> {
  if (path.isAbsolute(src) || /^[a-z]+:\/\//i.test(src)) throw new Error(`Asset path must be relative to the project: ${src}`);
  const rootReal = await realpath(root);
  let assetReal: string;
  try { assetReal = await realpath(path.resolve(rootReal, src)); }
  catch { throw new Error(`Asset not found: ${src}`); }
  if (assetReal !== rootReal && !assetReal.startsWith(rootReal + path.sep)) throw new Error(`Asset path escapes the project directory: ${src}`);
  return assetReal;
}
function captionNodes(project: Project, time: number) {
  const { width, height } = project.composition;
  return (project.captions ?? []).filter(c => time >= c.start && time < c.end).map(c => {
    const lines = c.text.split('\n');
    const lineHeight = c.fontSize * 1.24;
    const boxHeight = lines.length * lineHeight + 28;
    const y = height - Math.max(64, height * 0.075) - boxHeight;
    const text = lines.map((line, i) => `<tspan x="${width / 2}" y="${y + 22 + (i + 0.82) * lineHeight}">${escapeXml(line)}</tspan>`).join('');
    return `<rect x="${width * 0.075}" y="${y}" width="${width * 0.85}" height="${boxHeight}" rx="12" fill="${resolveColor(project, c.background)}" opacity="0.88"/><text font-family="sans-serif" font-size="${c.fontSize}" font-weight="600" text-anchor="middle" fill="${resolveColor(project, c.color)}">${text}</text>`;
  }).join('');
}
export async function svgFor(project: Project, projectFile: string, time: number, assetCache = new Map<string, string>()): Promise<string> {
  const comp = project.composition;
  const nodes: string[] = [];
  for (const { element, x, y, opacity, dy } of drawablesAt(project, time)) {
    if (element.type === 'rect') nodes.push(`<rect x="${x}" y="${y + dy}" width="${element.width}" height="${element.height}" rx="${element.radius}" fill="${resolveColor(project, element.color)}" opacity="${opacity}"/>`);
    else if (element.type === 'text') nodes.push(textNode({ ...element, x, y, fontFamily: element.fontFamily.startsWith('$') ? project.tokens!.fonts![element.fontFamily.slice(1)]! : element.fontFamily }, opacity, dy, resolveColor(project, element.color)));
    else {
      const asset = await safeAsset(path.dirname(projectFile), element.src);
      const ext = path.extname(asset).toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext)) throw new Error(`Unsupported image type: ${ext || '(no extension)'}`);
      let data = assetCache.get(asset);
      if (!data) {
        const bytes = await readFile(asset);
        const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.svg' ? 'image/svg+xml' : 'image/png';
        data = `data:${mime};base64,${bytes.toString('base64')}`;
        assetCache.set(asset, data);
      }
      nodes.push(`<image x="${x}" y="${y + dy}" width="${element.width}" height="${element.height}" href="${data}" preserveAspectRatio="${element.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}" opacity="${opacity}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${comp.width}" height="${comp.height}" viewBox="0 0 ${comp.width} ${comp.height}"><rect width="100%" height="100%" fill="${resolveColor(project, comp.background)}"/>${nodes.join('')}${captionNodes(project, time)}</svg>`;
}
export async function renderFrame(project: Project, projectFile: string, time: number, output: string) {
  const svg = await svgFor(project, projectFile, time);
  const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, png);
}
export async function renderVideo(project: Project, projectFile: string, output: string) {
  const frames = Math.ceil(project.composition.duration * project.composition.fps);
  const fps = project.composition.fps;
  const audio = project.audio ? await safeAsset(path.dirname(projectFile), project.audio.src) : undefined;
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'png', '-i', 'pipe:0'];
  if (audio && project.audio) {
    args.push('-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-af', `volume=${project.audio.volume},adelay=${Math.round(project.audio.start * 1000)}:all=1,apad,atrim=0:${project.composition.duration}`, '-c:a', 'aac', '-b:a', '192k');
  } else args.push('-an');
  args.push('-frames:v', String(frames), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.resolve(output));
  const child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  child.stdin.on('error', () => undefined);
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (part: string) => { stderr = (stderr + part).slice(-4000); });
  const completion = new Promise<void>((resolve, reject) => {
    child.on('error', e => reject(new Error(`Could not start FFmpeg: ${e.message}`)));
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`)));
  });
  completion.catch(() => undefined);
  const assetCache = new Map<string, string>();
  try {
    for (let frame = 0; frame < frames; frame++) {
      const svg = await svgFor(project, projectFile, frame / fps, assetCache);
      const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
      await new Promise<void>((resolve, reject) => child.stdin.write(png, error => error ? reject(error) : resolve()));
    }
    child.stdin.end();
    await completion;
  } catch (error) {
    child.kill();
    await completion.catch(() => undefined);
    throw error;
  }
}
