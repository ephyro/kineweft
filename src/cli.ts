#!/usr/bin/env node
import { addElement, initProject, inspectProject, previewProject, renderProject, updateElement } from './core.js';

function help() {
  console.log(`Kineweft — deterministic motion design\n\nUsage:\n  kineweft init <project.json> [--example <file>]\n  kineweft inspect <project.json>\n  kineweft add <project.json> <element.json>\n  kineweft update <project.json> <id> <patch.json|inline-json>\n  kineweft preview <project.json> <seconds> <frame.png>\n  kineweft render <project.json> <video.mp4>\n\nThe add argument is an element JSON file. Update accepts a JSON file or inline object. See examples/technical-reel.kineweft.json.`);
}
async function main(args: string[]) {
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help') return help();
  let result: unknown;
  if (command === 'init') {
    const output = rest[0]; if (!output) throw new Error('Expected project output path');
    const exampleIndex = rest.indexOf('--example');
    result = await initProject(output, exampleIndex >= 0 ? rest[exampleIndex+1] : undefined);
  } else if (command === 'inspect') result = await inspectProject(rest[0] ?? '');
  else if (command === 'add') {
    if (!rest[0] || !rest[1]) throw new Error('Expected project path and element JSON file');
    result = await addElement(rest[0], JSON.parse(await (await import('node:fs/promises')).readFile(rest[1], 'utf8')));
  } else if (command === 'update') {
    if (!rest[0] || !rest[1] || !rest[2]) throw new Error('Expected project path, element ID, and patch JSON file');
    const patch = rest[2].startsWith('{') ? JSON.parse(rest[2]) : JSON.parse(await (await import('node:fs/promises')).readFile(rest[2], 'utf8'));
    result = await updateElement(rest[0], rest[1], patch);
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
