import { z } from 'zod';

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/, 'ID must be 1–64 safe characters');
const color = z.string().regex(/^(#[0-9a-fA-F]{6}|\$[a-zA-Z][a-zA-Z0-9_-]*)$/, 'Expected #RRGGBB or a $color token');
const easing = z.enum(['linear', 'easeInCubic', 'easeOutCubic', 'easeInOutCubic']);
const animation = z.object({ type: z.enum(['fade', 'rise']), duration: z.number().positive().max(10).default(0.5), easing: easing.default('easeOutCubic') });
const exitAnimation = z.object({ type: z.enum(['fade', 'rise']), duration: z.number().positive().max(10).default(0.5), easing: easing.default('easeInCubic') });
const common = {
  id, x: z.number().finite(), y: z.number().finite(),
  opacity: z.number().min(0).max(1).default(1),
  start: z.number().min(0).finite().default(0), end: z.number().positive().finite(),
  animation: animation.optional(), exitAnimation: exitAnimation.optional()
};
const textFields = {
  text: z.string().min(1).max(2000), fontSize: z.number().positive().max(1000).default(64),
  colorGroup: id.optional(),
  fontWeight: z.number().int().min(100).max(900).default(600),
  letterSpacing: z.number().min(-20).max(100).default(0),
  lineHeight: z.number().min(0.8).max(3).default(1.18),
  color, width: z.number().positive().optional(), height: z.number().positive().optional(),
  align: z.enum(['start', 'middle', 'end']).default('start'),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  fit: z.enum(['none', 'shrink']).default('none'), minFontSize: z.number().positive().optional(),
  wrap: z.enum(['none', 'word']).default('none'),
  fontFamily: z.string().max(100).default('sans-serif')
};
export const visualElementSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('text'), ...textFields }),
  z.object({ ...common, type: z.literal('rect'), width: z.number().positive(), height: z.number().positive(), color, colorGroup: id.optional(), radius: z.number().min(0).default(0) }),
  z.object({ ...common, type: z.literal('image'), src: z.string().min(1), width: z.number().positive(), height: z.number().positive(), fit: z.enum(['contain', 'cover']).default('contain') })
]);
export const elementSchema = z.discriminatedUnion('type', [
  ...visualElementSchema.options,
  z.object({ ...common, type: z.literal('component'), name: id })
]);
const sceneSchema = z.object({ id, start: z.number().min(0), duration: z.number().positive(), elements: z.array(elementSchema) });
const captionSchema = z.object({ id, text: z.string().min(1).max(1000), start: z.number().min(0), end: z.number().positive(), color: color.default('#ffffff'), background: color.default('#000000'), fontSize: z.number().positive().default(40) });
const projectShape = z.object({
  format: z.literal('kineweft'), version: z.union([z.literal(1), z.literal(2)]),
  composition: z.object({ width: z.number().int().min(16).max(4096), height: z.number().int().min(16).max(4096), fps: z.number().int().min(1).max(120), duration: z.number().positive().max(600), background: color }),
  tokens: z.object({ colors: z.record(id, z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(), fonts: z.record(id, z.string().min(1).max(100)).optional() }).optional(),
  components: z.record(id, z.array(visualElementSchema)).optional(),
  elements: z.array(elementSchema), scenes: z.array(sceneSchema).optional(),
  quality: z.object({
    minTextContrast: z.number().min(1).max(21).default(4.5),
    minLargeTextContrast: z.number().min(1).max(21).default(3),
    minSurfaceContrast: z.number().min(1).max(21).default(1.4),
    enforceContrast: z.boolean().default(false),
    enforcePalette: z.boolean().default(false)
  }).optional(),
  audio: z.object({ src: z.string().min(1), volume: z.number().min(0).max(4).default(1), start: z.number().min(0).default(0) }).optional(),
  captions: z.array(captionSchema).optional()
});
export const projectSchema = projectShape.superRefine((p, ctx) => {
  const ids = new Set<string>();
  const checkElements = (elements: z.infer<typeof elementSchema>[], path: (string | number)[], limit: number) => {
    const local = new Set<string>();
    elements.forEach((e, i) => {
      if (local.has(e.id)) ctx.addIssue({ code: 'custom', path: [...path, i, 'id'], message: `Duplicate element ID: ${e.id}` });
      local.add(e.id);
      if (e.end <= e.start || e.end > limit) ctx.addIssue({ code: 'custom', path: [...path, i, 'end'], message: `Element end must be after start and within ${limit}s` });
      const life = e.end - e.start;
      if (e.animation && e.animation.duration > life) ctx.addIssue({ code: 'custom', path: [...path, i, 'animation'], message: 'Entrance animation exceeds element lifespan' });
      if (e.exitAnimation && e.exitAnimation.duration > life) ctx.addIssue({ code: 'custom', path: [...path, i, 'exitAnimation'], message: 'Exit animation exceeds element lifespan' });
      if (e.type === 'component' && !p.components?.[e.name]) ctx.addIssue({ code: 'custom', path: [...path, i, 'name'], message: `Unknown component: ${e.name}` });
      if (e.type === 'text' && e.minFontSize && e.minFontSize > e.fontSize) ctx.addIssue({ code: 'custom', path: [...path, i, 'minFontSize'], message: 'Minimum font size exceeds fontSize' });
    });
  };
  checkElements(p.elements, ['elements'], p.composition.duration);
  if (p.audio && p.audio.start >= p.composition.duration) ctx.addIssue({ code: 'custom', path: ['audio', 'start'], message: 'Audio start must be within the composition duration' });
  p.elements.forEach(e => ids.add(e.id));
  p.scenes?.forEach((s, i) => {
    if (ids.has(s.id)) ctx.addIssue({ code: 'custom', path: ['scenes', i, 'id'], message: `Duplicate ID: ${s.id}` });
    ids.add(s.id);
    if (s.start + s.duration > p.composition.duration) ctx.addIssue({ code: 'custom', path: ['scenes', i], message: 'Scene exceeds composition duration' });
    checkElements(s.elements, ['scenes', i, 'elements'], s.duration);
  });
  Object.entries(p.components ?? {}).forEach(([name, elements]) => checkElements(elements, ['components', name], p.composition.duration));
  p.captions?.forEach((c, i) => {
    if (ids.has(c.id)) ctx.addIssue({ code: 'custom', path: ['captions', i, 'id'], message: `Duplicate ID: ${c.id}` });
    ids.add(c.id);
    if (c.end <= c.start || c.end > p.composition.duration) ctx.addIssue({ code: 'custom', path: ['captions', i, 'end'], message: 'Caption timing exceeds composition' });
  });
  const colors = p.tokens?.colors ?? {};
  const fonts = p.tokens?.fonts ?? {};
  const groups = new Map<string, { color: string; id: string }>();
  const checkColor = (value: string, path: (string | number)[]) => {
    if (value.startsWith('$') && !colors[value.slice(1)]) ctx.addIssue({ code: 'custom', path, message: `Unknown color token: ${value}` });
    if (p.quality?.enforcePalette && !value.startsWith('$') && !Object.values(colors).some(c => c.toLowerCase() === value.toLowerCase()))
      ctx.addIssue({ code: 'custom', path, message: `Color ${value} is outside the project palette` });
  };
  checkColor(p.composition.background, ['composition', 'background']);
  const colorsIn = (elements: z.infer<typeof elementSchema>[], path: (string | number)[]) => elements.forEach((e, i) => {
    if (e.type === 'text' || e.type === 'rect') {
      checkColor(e.color, [...path, i, 'color']);
      if (e.colorGroup) {
        const value = (e.color.startsWith('$') ? colors[e.color.slice(1)] : e.color)?.toLowerCase();
        const previous = groups.get(e.colorGroup);
        if (value && previous && value !== previous.color)
          ctx.addIssue({ code: 'custom', path: [...path, i, 'color'], message: `Color group ${e.colorGroup} must match ${previous.id}` });
        else if (value && !previous) groups.set(e.colorGroup, { color: value, id: e.id });
      }
    }
    if (e.type === 'text' && e.fontFamily.startsWith('$') && !fonts[e.fontFamily.slice(1)]) ctx.addIssue({ code: 'custom', path: [...path, i, 'fontFamily'], message: `Unknown font token: ${e.fontFamily}` });
  });
  colorsIn(p.elements, ['elements']);
  p.scenes?.forEach((s, i) => colorsIn(s.elements, ['scenes', i, 'elements']));
  Object.entries(p.components ?? {}).forEach(([name, elements]) => colorsIn(elements, ['components', name]));
  p.captions?.forEach((c, i) => { checkColor(c.color, ['captions', i, 'color']); checkColor(c.background, ['captions', i, 'background']); });
});
export type Element = z.infer<typeof elementSchema>;
export type VisualElement = z.infer<typeof visualElementSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ElementInput = z.input<typeof elementSchema>;
export type SceneInput = z.input<typeof sceneSchema>;
export const parseScene = (input: SceneInput) => sceneSchema.parse(input);
export const projectPatchSchema = projectShape.pick({ composition: true, tokens: true, components: true, scenes: true, quality: true, audio: true, captions: true }).partial().extend({
  composition: projectShape.shape.composition.partial().optional(),
  quality: projectShape.shape.quality.unwrap().partial().optional()
}).strict();

export function validateProject(data: unknown): Project {
  const result = projectSchema.safeParse(data);
  if (!result.success) throw new Error(result.error.issues.map(i => `${i.path.join('.') || 'project'}: ${i.message}`).join('\n'));
  return result.data;
}
