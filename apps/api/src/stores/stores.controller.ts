import { Body, Controller, Get, Put } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../common/auth.types';
import { notFound } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { DbService } from '../db/db.service';
import { CurrentUser } from '../auth/decorators';

const HomeStoreSchema = z.object({ storeId: z.number().int().positive().nullable() });
type HomeStoreDto = z.infer<typeof HomeStoreSchema>;

@Controller()
export class StoresController {
  constructor(private readonly db: DbService) {}

  @Get('stores')
  async list() {
    const r = await this.db.query<{
      id: number; code: string; name: string; city: string;
      latitude: number | null; longitude: number | null; click_and_collect: boolean;
    }>('SELECT id, code, name, city, latitude, longitude, click_and_collect FROM stores ORDER BY id');
    return r.rows.map((s) => ({
      id: s.id, code: s.code, name: s.name, city: s.city,
      latitude: s.latitude, longitude: s.longitude, clickAndCollect: s.click_and_collect,
    }));
  }

  @Put('me/home-store')
  async setHomeStore(@CurrentUser() user: AuthUser, @Body(new ZodPipe(HomeStoreSchema)) dto: HomeStoreDto) {
    if (dto.storeId !== null) {
      const s = await this.db.query('SELECT 1 FROM stores WHERE id = $1', [dto.storeId]);
      if (s.rowCount === 0) throw notFound('STORE_NOT_FOUND', 'Store not found');
    }
    await this.db.query('UPDATE users SET home_store_id = $1 WHERE id = $2', [dto.storeId, user.id]);
    return { storeId: dto.storeId };
  }
}