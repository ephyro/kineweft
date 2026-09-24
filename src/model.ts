import { z } from 'zod';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex color such as #f4f0e6');
const easing = z.enum(['linear', 'easeInCubic', 'easeOutCubic', 'easeInOutCubic']);
const entranceAnimation = z.object({
  type: z.enum(['fade', 'rise']),
  duration: z.number().positive().max(10).default(0.5),
  easing: easing.default('easeOutCubic')
});
const exitAnimation = z.object({
  type: z.enum(['fade', 'rise']),
  duration: z.number().positive().max(10).default(0.5),
  easing: easing.default('easeInCubic')
});
const common = {
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/, 'ID must be 1–64 safe characters'),
  x: z.number().finite(), y: z.number().finite(),
  opacity: z.number().min(0).max(1).default(1),
  start: z.number().min(0).finite().default(0), end: z.number().min(0).finite(),
  animation: entranceAnimation.optional(),
  exitAnimation: exitAnimation.optional()
};
export const elementSchema = z.discriminatedUnion('type', [
  z.object({
    ...common,
    type: z.literal('text'), text: z.string().min(1).max(2000),
    fontSize: z.number().positive().max(1000).default(64),
    fontWeight: z.number().int().min(100).max(900).default(600),
    letterSpacing: z.number().min(-20).max(100).default(0),
    lineHeight: z.number().min(0.8).max(3).default(1.18),
    color, width: z.number().positive().optional(),
    align: z.enum(['start','middle','end']).default('start'),
    fontFamily: z.string().max(100).default('sans-serif')
  }),
  z.object({ ...common, type: z.literal('rect'), width: z.number().positive(), height: z.number().positive(), color, radius: z.number().min(0).default(0) }),
  z.object({ ...common, type: z.literal('image'), src: z.string().min(1), width: z.number().positive(), height: z.number().positive(), fit: z.enum(['contain','cover']).default('contain') })
]);
export const projectSchema = z.object({
  format: z.literal('kineweft'), version: z.literal(1),
  composition: z.object({ width: z.number().int().min(16).max(4096), height: z.number().int().min(16).max(4096), fps: z.number().int().min(1).max(120), duration: z.number().positive().max(600), background: color }),
  elements: z.array(elementSchema)
}).superRefine((p, ctx) => {
  const ids = new Set<string>();
  p.elements.forEach((e, i) => {
    if (ids.has(e.id)) ctx.addIssue({ code: 'custom', path: ['elements', i, 'id'], message: `Duplicate element ID: ${e.id}` });
    ids.add(e.id);
    if (e.end <= e.start || e.end > p.composition.duration) ctx.addIssue({ code: 'custom', path: ['elements', i, 'end'], message: 'Element end must be after start and within the composition duration' });
    const lifespan = e.end - e.start;
    if (e.animation && e.animation.duration > lifespan) ctx.addIssue({ code: 'custom', path: ['elements', i, 'animation', 'duration'], message: 'Entrance animation cannot exceed the element lifespan' });
    if (e.exitAnimation && e.exitAnimation.duration > lifespan) ctx.addIssue({ code: 'custom', path: ['elements', i, 'exitAnimation', 'duration'], message: 'Exit animation cannot exceed the element lifespan' });
  });
});
export type Element = z.infer<typeof elementSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ElementInput = z.input<typeof elementSchema>;

export function validateProject(data: unknown): Project {
  const result = projectSchema.safeParse(data);
  if (!result.success) throw new Error(result.error.issues.map(i => `${i.path.join('.') || 'project'}: ${i.message}`).join('\n'));
  return result.data;
}
