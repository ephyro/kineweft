#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { addElement, addScene, initProject, inspectProject, lintProject, previewProject, renderProject, updateElement, updateProject } from './core.js';

function help() {
  console.log(`Kineweft — deterministic motion design

Usage:
  kineweft init <project.json> [--example <file>]
  kineweft inspect <project.json>
  kineweft add <project.json> <element.json> [--scene <id>]
  kineweft update <project.json> <id> <patch.json|inline-json> [--scene <id>]
  kineweft add-scene <project.json> <scene.json>
  kineweft update-project <project.json> <patch.json|inline-json>
  kineweft lint <project.json>
  kineweft preview <project.json> <seconds> <frame.png>
  kineweft render <project.json> <video.mp4>`);
}
async function jsonArg(value: string) { return JSON.parse(value.startsWith('{') ? value : await readFile(value, 'utf8')); }
async function main(args: string[]) {
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help') return help();
  let result: unknown;
  const sceneIndex = rest.indexOf('--scene');
  const sceneId = sceneIndex >= 0 ? rest[sceneIndex + 1] : undefined;
  if (command === 'init') {
    const output = rest[0]; if (!output) throw new Error('Expected project output path');
    const exampleIndex = rest.indexOf('--example');
    result = await initProject(output, exampleIndex >= 0 ? rest[exampleIndex + 1] : undefined);
  } else if (command === 'inspect') result = await inspectProject(rest[0] ?? '');
  else if (command === 'lint') result = await lintProject(rest[0] ?? '');
  else if (command === 'add') {
    if (!rest[0] || !rest[1]) throw new Error('Expected project path and element JSON file');
    result = await addElement(rest[0], await jsonArg(rest[1]), sceneId);
  } else if (command === 'update') {
    if (!rest[0] || !rest[1] || !rest[2]) throw new Error('Expected project path, element ID, and patch JSON');
    result = await updateElement(rest[0], rest[1], await jsonArg(rest[2]), sceneId);
  } else if (command === 'add-scene') {
    if (!rest[0] || !rest[1]) throw new Error('Expected project path and scene JSON file');
    result = await addScene(rest[0], await jsonArg(rest[1]));
  } else if (command === 'update-project') {
    if (!rest[0] || !rest[1]) throw new Error('Expected project path and patch JSON');
    result = await updateProject(rest[0], await jsonArg(rest[1]));
  } else if (command === 'preview') {
    if (!rest[0] || !rest[1] || !rest[2]) throw new Error('Expected project path, time in seconds, and output PNG');
    result = await previewProject(rest[0], Number(rest[1]), rest[2]);
  } else if (command === 'render') {
    if (!rest[0] || !rest[1]) throw new Error('Expected project path and output MP4');
    result = await renderProject(rest[0], rest[1]);
  } else throw new Error(`Unknown command: ${command}`);
  console.log(JSON.stringify(result, null, 2));
}
main(process.argv.slice(2)).catch(error => { console.error(`kineweft: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
