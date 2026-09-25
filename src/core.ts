import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { elementSchema, parseScene, projectPatchSchema, validateProject, type ElementInput, type Project, type SceneInput } from './model.js';
import { drawablesAt, renderFrame, renderVideo, safeAsset } from './renderer.js';
import { textLayout, textPosition } from './text.js';
import { colorIssuesAt } from './color.js';
import { fileURLToPath } from 'node:url';

export const examplePath = fileURLToPath(new URL('../examples/technical-reel.kineweft.json', import.meta.url));
export async function readProject(file: string): Promise<Project> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(file, 'utf8')); } catch (e) { throw new Error(`Cannot read project ${file}: ${e instanceof Error ? e.message : String(e)}`); }
  return validateProject(raw);
}
export async function writeProject(file: string, project: Project): Promise<void> {
  const valid = validateProject(project);
  guardContrast(valid);
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, `${JSON.stringify(valid, null, 2)}\n`);
}
export async function initProject(output: string, source?: string): Promise<Project> {
  const input = path.resolve(source ?? examplePath);
  const project = await readProject(input);
  const refs = new Set<string>();
  const collect = (elements: Project['elements']) => elements.forEach(e => { if (e.type === 'image') refs.add(e.src); });
  collect(project.elements);
  project.scenes?.forEach(s => collect(s.elements));
  Object.values(project.components ?? {}).forEach(collect);
  if (project.audio) refs.add(project.audio.src);
  const outputRoot = path.resolve(path.dirname(output));
  await mkdir(outputRoot, { recursive: true });
  const outputRootReal = await realpath(outputRoot);
  for (const ref of refs) {
    const asset = await safeAsset(path.dirname(input), ref);
    const destination = path.resolve(outputRoot, ref);
    if (destination !== outputRoot && !destination.startsWith(outputRoot + path.sep)) throw new Error(`Asset path escapes output directory: ${ref}`);
    await mkdir(path.dirname(destination), { recursive: true });
    const parentReal = await realpath(path.dirname(destination));
    if (parentReal !== outputRootReal && !parentReal.startsWith(outputRootReal + path.sep)) throw new Error(`Asset destination escapes output directory: ${ref}`);
    try { if ((await lstat(destination)).isSymbolicLink()) throw new Error(`Asset destination is a symlink: ${ref}`); }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
    if (asset !== destination) await copyFile(asset, destination);
  }
  await writeProject(output, project);
  return project;
}
export async function inspectProject(file: string) {
  return readProject(file);
}
export async function addElement(file: string, input: ElementInput, sceneId?: string) {
  const project = await readProject(file);
  const element = elementSchema.parse(input);
  let updated: Project;
  if (sceneId) {
    const index = project.scenes?.findIndex(s => s.id === sceneId) ?? -1;
    if (index < 0) throw new Error(`No scene with ID: ${sceneId}`);
    const scenes = [...project.scenes!];
    const scene = scenes[index]!;
    scenes[index] = { ...scene, elements: [...scene.elements, element] };
    updated = validateProject({ ...project, scenes });
  } else updated = validateProject({ ...project, elements: [...project.elements, element] });
  await writeProject(file, updated);
  return element;
}
export async function updateElement(file: string, id: string, patch: Record<string, unknown>, sceneId?: string) {
  const project = await readProject(file);
  const sceneIndex = sceneId ? project.scenes?.findIndex(s => s.id === sceneId) ?? -1 : -1;
  if (sceneId && sceneIndex < 0) throw new Error(`No scene with ID: ${sceneId}`);
  const source = sceneId ? project.scenes![sceneIndex]!.elements : project.elements;
  const index = source.findIndex(e => e.id === id);
  if (index < 0) throw new Error(`No element with ID: ${id}`);
  if ('id' in patch || 'type' in patch) throw new Error('Element ID and type cannot be changed');
  const element = elementSchema.parse({ ...source[index], ...patch });
  const elements = [...source]; elements[index] = element;
  const scenes = sceneId ? [...project.scenes!] : undefined;
  if (scenes) scenes[sceneIndex] = { ...scenes[sceneIndex]!, elements };
  const updated = validateProject(sceneId ? { ...project, scenes } : { ...project, elements });
  await writeProject(file, updated);
  return element;
}
export async function addScene(file: string, input: SceneInput) {
  const project = await readProject(file);
  const scene = parseScene(input);
  const updated = validateProject({ ...project, version: 2, scenes: [...(project.scenes ?? []), scene] });
  await writeProject(file, updated);
  return scene;
}
export async function updateProject(file: string, patch: Record<string, unknown>) {
  const project = await readProject(file);
  const parsed = projectPatchSchema.parse(patch);
  const updated = validateProject({ ...project, ...parsed, version: 2, composition: { ...project.composition, ...parsed.composition }, tokens: parsed.tokens ? { colors: { ...project.tokens?.colors, ...parsed.tokens.colors }, fonts: { ...project.tokens?.fonts, ...parsed.tokens.fonts } } : project.tokens, quality: parsed.quality ? { ...project.quality, ...parsed.quality } : project.quality });
  await writeProject(file, updated);
  return updated;
}
export async function lintProject(file: string) {
  const project = await readProject(file);
  return lintProjectData(project);
}
function lintProjectData(project: Project) {
  const issues: { id: string; time: number; kind: 'layout' | 'contrast'; message: string }[] = [];
  const times = new Set<number>([0, project.composition.duration / 2]);
  project.elements.forEach(e => times.add((e.start + e.end) / 2));
  project.scenes?.forEach(s => s.elements.forEach(e => times.add(s.start + (e.start + e.end) / 2)));
  project.captions?.forEach(c => times.add((c.start + c.end) / 2));
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const time of times) {
    const items = drawablesAt(project, time);
    for (const issue of colorIssuesAt(project, items, time)) {
      const key = `${issue.id}|${issue.message.split('(')[0]}`;
      if (!reported.has(key)) { issues.push(issue); reported.add(key); }
    }
    for (const { element, x, y } of items) {
      const key = `${element.id}@${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let left = x, top = y, width = 0, height = 0;
      if (element.type === 'text') {
        const text = { ...element, fontFamily: element.fontFamily.startsWith('$') ? project.tokens!.fonts![element.fontFamily.slice(1)]! : element.fontFamily };
        const layout = textLayout(text);
        const position = textPosition({ ...text, x, y }, layout);
        left = position.left; top = position.top;
        width = layout.width; height = layout.height;
        if (layout.overflow) issues.push({ id: element.id, time, kind: 'layout', message: 'Text exceeds its width or height; increase the box or enable shrink fitting' });
      } else { width = element.width; height = element.height; }
      if (left < -1 || top < -1 || left + width > project.composition.width + 1 || top + height > project.composition.height + 1)
        issues.push({ id: element.id, time, kind: 'layout', message: 'Content extends outside the canvas' });
    }
  }
  return { issues, checked: seen.size };
}
function guardContrast(project: Project) {
  if (!project.quality?.enforceContrast) return;
  const issues = lintProjectData(project).issues.filter(issue => issue.kind === 'contrast');
  if (issues.length) throw new Error(`Contrast guard failed: ${issues.slice(0, 3).map(issue => `${issue.id}: ${issue.message}`).join('; ')}. Run 'kineweft lint' for details.`);
}
export async function previewProject(file: string, at: number, output: string) {
  const project = await readProject(file);
  if (!Number.isFinite(at) || at < 0 || at > project.composition.duration) throw new Error(`Preview time must be between 0 and ${project.composition.duration}`);
  await renderFrame(project, path.resolve(file), at, output);
  return { output, time: at };
}
export async function renderProject(file: string, output: string) {
  const project = await readProject(file);
  guardContrast(project);
  await renderVideo(project, path.resolve(file), output);
  return { output, fps: project.composition.fps, duration: project.composition.duration };
}
