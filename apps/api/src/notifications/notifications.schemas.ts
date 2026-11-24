import { z } from 'zod';

export const ListNotificationsQuery = z.object({
  unread: z.enum(['true', 'false']).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListNotificationsDto = z.infer<typeof ListNotificationsQuery>;

export const NotificationCursor = z.object({
  t: z.string().min(1).max(40), // created_at with microsecond precision, as text
  id: z.string().uuid(),
});