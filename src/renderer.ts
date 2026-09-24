import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import type { Element, Project } from './model.js';

const escapeXml = (s: string) => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
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
  const entranceOffset = e.animation?.type === 'rise' ? (1 - entrance) * 32 : 0;
  const exitOffset = e.exitAnimation?.type === 'rise' ? -leaving * 24 : 0;
  return { opacity: e.opacity * entrance * (1 - leaving), dy: entranceOffset + exitOffset };
}
async function safeAsset(root: string, src: string) {
  if (path.isAbsolute(src)) throw new Error(`Image path must be relative to the project: ${src}`);
  const rootReal = await realpath(root);
  const assetReal = await realpath(path.resolve(rootReal, src));
  if (assetReal !== rootReal && !assetReal.startsWith(rootReal + path.sep)) throw new Error(`Image path escapes the project directory: ${src}`);
  return assetReal;
}
async function svgFor(project: Project, projectFile: string, time: number): Promise<string> {
  const comp = project.composition;
  const nodes: string[] = [];
  for (const element of project.elements) {
    const s = state(element, time);
    if (!s.opacity) continue;
    const transform = `translate(${element.x} ${element.y + s.dy})`;
    if (element.type === 'rect') nodes.push(`<rect x="${element.x}" y="${element.y+s.dy}" width="${element.width}" height="${element.height}" rx="${element.radius}" fill="${element.color}" opacity="${s.opacity}"/>`);
    else if (element.type === 'text') {
      const lines = element.text.split('\n');
      const anchor = element.align === 'middle' ? 'middle' : element.align === 'end' ? 'end' : 'start';
      const x = element.align === 'middle' ? (element.width ?? 0)/2 : element.align === 'end' ? (element.width ?? 0) : 0;
      const tspan = lines.map((line, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : element.fontSize * element.lineHeight}">${escapeXml(line)}</tspan>`).join('');
      nodes.push(`<text transform="${transform}" x="0" y="0" font-family="${escapeXml(element.fontFamily)}" font-size="${element.fontSize}" font-weight="${element.fontWeight}" letter-spacing="${element.letterSpacing}" text-anchor="${anchor}" fill="${element.color}" opacity="${s.opacity}">${tspan}</text>`);
    } else {
      const asset = await safeAsset(path.dirname(projectFile), element.src);
      const data = await readFile(asset);
      const ext = path.extname(asset).toLowerCase();
      if (!['.png','.jpg','.jpeg','.webp','.svg'].includes(ext)) throw new Error(`Unsupported image type: ${ext || '(no extension)'}`);
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.svg' ? 'image/svg+xml' : 'image/png';
      nodes.push(`<image x="${element.x}" y="${element.y+s.dy}" width="${element.width}" height="${element.height}" href="data:${mime};base64,${data.toString('base64')}" preserveAspectRatio="${element.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}" opacity="${s.opacity}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${comp.width}" height="${comp.height}" viewBox="0 0 ${comp.width} ${comp.height}"><rect width="100%" height="100%" fill="${comp.background}"/>${nodes.join('')}</svg>`;
}
export async function renderFrame(project: Project, projectFile: string, time: number, output: string) {
  const svg = await svgFor(project, projectFile, time);
  const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, png);
}
function run(program: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8'); child.stderr.on('data', (part: string) => stderr += part);
    child.on('error', e => reject(new Error(`Could not start ${program}: ${e.message}`)));
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${program} exited with code ${code}: ${stderr.slice(-2000)}`)));
  });
}
export async function renderVideo(project: Project, projectFile: string, output: string) {
  const frames = Math.ceil(project.composition.duration * project.composition.fps);
  const tmp = await mkdtemp(path.join(process.env.TMPDIR ?? '/tmp', 'kineweft-'));
  try {
    for (let frame = 0; frame < frames; frame++) {
      const svg = await svgFor(project, projectFile, frame / project.composition.fps);
      const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
      await writeFile(path.join(tmp, `frame-${String(frame).padStart(6,'0')}.png`), png);
    }
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    const absoluteOutput = path.resolve(output);
    await run('ffmpeg', ['-hide_banner','-loglevel','error','-y','-framerate',String(project.composition.fps),'-i',path.join(tmp,'frame-%06d.png'),'-frames:v',String(frames),'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',absoluteOutput]);
  } finally { await rm(tmp, { recursive: true, force: true }); }
}
