import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { elementSchema, validateProject, type ElementInput, type Project } from './model.js';
import { renderFrame, renderVideo } from './renderer.js';
import { fileURLToPath } from 'node:url';

export const examplePath = fileURLToPath(new URL('../examples/technical-reel.kineweft.json', import.meta.url));
export async function readProject(file: string): Promise<Project> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(file, 'utf8')); } catch (e) { throw new Error(`Cannot read project ${file}: ${e instanceof Error ? e.message : String(e)}`); }
  return validateProject(raw);
}
export async function writeProject(file: string, project: Project): Promise<void> {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, `${JSON.stringify(validateProject(project), null, 2)}\n`);
}
export async function initProject(output: string, source?: string): Promise<Project> {
  const project = await readProject(source ?? examplePath);
  await writeProject(output, project);
  return project;
}
export async function inspectProject(file: string) {
  const project = await readProject(file);
  return { format: project.format, version: project.version, composition: project.composition, elements: project.elements };
}
export async function addElement(file: string, input: ElementInput) {
  const project = await readProject(file);
  const element = elementSchema.parse(input);
  if (project.elements.some(e => e.id === element.id)) throw new Error(`Element ID already exists: ${element.id}`);
  const updated = validateProject({ ...project, elements: [...project.elements, element] });
  await writeProject(file, updated);
  return element;
}
export async function updateElement(file: string, id: string, patch: Record<string, unknown>) {
  const project = await readProject(file);
  const index = project.elements.findIndex(e => e.id === id);
  if (index < 0) throw new Error(`No element with ID: ${id}`);
  if ('id' in patch || 'type' in patch) throw new Error('Element ID and type cannot be changed');
  const element = elementSchema.parse({ ...project.elements[index], ...patch });
  const elements = [...project.elements]; elements[index] = element;
  const updated = validateProject({ ...project, elements });
  await writeProject(file, updated);
  return element;
}
export async function previewProject(file: string, at: number, output: string) {
  const project = await readProject(file);
  if (!Number.isFinite(at) || at < 0 || at > project.composition.duration) throw new Error(`Preview time must be between 0 and ${project.composition.duration}`);
  await renderFrame(project, path.resolve(file), at, output);
  return { output, time: at };
}
export async function renderProject(file: string, output: string) {
  const project = await readProject(file);
  await renderVideo(project, path.resolve(file), output);
  return { output, fps: project.composition.fps, duration: project.composition.duration };
}
