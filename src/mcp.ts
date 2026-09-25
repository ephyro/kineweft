#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { addElement, addScene, initProject, inspectProject, lintProject, previewProject, renderProject, updateElement, updateProject } from './core.js';
import { elementSchema, projectPatchSchema } from './model.js';

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const withErrors = async (fn: () => Promise<unknown>) => { try { return result(await fn()); } catch (e) { return { isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] }; } };
function buildServer() {
  const server = new McpServer({ name: 'kineweft', version: '0.1.0' });
  server.registerTool('create_project', { description: 'Create a Kineweft project, optionally copying the included demo.', inputSchema: { path: z.string(), example: z.string().optional() } }, async ({ path, example }) => withErrors(() => initProject(path, example)));
  server.registerTool('inspect_project', { description: 'Read and validate a Kineweft project.', inputSchema: { path: z.string() } }, async ({ path }) => withErrors(() => inspectProject(path)));
  server.registerTool('lint_project', { description: 'Check text fitting, canvas bounds, and text/surface color contrast.', inputSchema: { path: z.string() } }, async ({ path }) => withErrors(() => lintProject(path)));
  server.registerTool('add_element', { description: 'Add one declarative element, optionally inside a scene.', inputSchema: { path: z.string(), element: elementSchema, sceneId: z.string().optional() } }, async ({ path, element, sceneId }) => withErrors(() => addElement(path, element, sceneId)));
  server.registerTool('update_element', { description: 'Update an existing element by stable ID. ID and type remain fixed.', inputSchema: { path: z.string(), id: z.string(), patch: z.record(z.string(), z.unknown()), sceneId: z.string().optional() } }, async ({ path, id, patch, sceneId }) => withErrors(() => updateElement(path, id, patch, sceneId)));
  server.registerTool('add_scene', { description: 'Add a scene with local element timing.', inputSchema: { path: z.string(), scene: z.object({ id: z.string(), start: z.number(), duration: z.number(), elements: z.array(elementSchema) }) } }, async ({ path, scene }) => withErrors(() => addScene(path, scene)));
  server.registerTool('update_project', { description: 'Update composition, design tokens, components, scenes, audio, or captions through validation.', inputSchema: { path: z.string(), patch: projectPatchSchema } }, async ({ path, patch }) => withErrors(() => updateProject(path, patch)));
  server.registerTool('preview_frame', { description: 'Render one deterministic PNG frame at a time in seconds.', inputSchema: { path: z.string(), time: z.number().min(0), output: z.string() } }, async ({ path, time, output }) => withErrors(() => previewProject(path, time, output)));
  server.registerTool('render_video', { description: 'Render the project to H.264 MP4 using local FFmpeg.', inputSchema: { path: z.string(), output: z.string() } }, async ({ path, output }) => withErrors(() => renderProject(path, output)));
  return server;
}
serveStdio(buildServer, { onerror: error => console.error(`kineweft-mcp: ${error.message}`) });
