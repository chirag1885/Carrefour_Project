import { z } from 'zod';

export const SimulatorConfigSchema = z.strictObject({
  eventsPerSecond: z.number().int().min(0).max(50).optional(),
  seed: z.number().int().min(0).optional(),
});
export type SimulatorConfigDto = z.output<typeof SimulatorConfigSchema>;
