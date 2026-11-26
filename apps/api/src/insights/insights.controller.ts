import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe';
import { PriceHistoryDto, PriceHistoryQuery } from './insights.schemas';
import { InsightsService } from './insights.service';

@Controller('products')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get(':id/price-history')
  @Header('Cache-Control', 'private, no-cache')
  priceHistory(@Param('id') id: string, @Query(new ZodPipe(PriceHistoryQuery)) q: PriceHistoryDto) {
    return this.insights.priceHistory(id, q.range);
  }

  @Get(':id/similar')
  @Header('Cache-Control', 'private, no-cache')
  similar(@Param('id') id: string) {
    return this.insights.similar(id);
  }
}