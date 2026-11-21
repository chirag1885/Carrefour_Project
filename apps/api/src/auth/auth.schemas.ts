import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(72), // 72 = bcrypt's input limit
  fullName: z.string().trim().min(1).max(120),
  locale: z.enum(['en', 'ar']).default('en'),
});
export type RegisterDto = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(72),
});
export type LoginDto = z.infer<typeof LoginSchema>;