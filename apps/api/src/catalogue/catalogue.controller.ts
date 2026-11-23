import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe';
import { CatalogueService } from './catalogue.service';
import { ListProductsDto, ListProductsQuery } from './catalogue.schemas';
import { PriceHistoryDto, PriceHistoryQuery } from './price-history.schemas';
import { PriceHistoryService } from './price-history.service';

// Express adds a weak ETag and answers If-None-Match with 304 automatically.
// "private, no-cache" lets the browser store the response but always revalidate it.
@Controller('products')
export class CatalogueController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly priceHistory: PriceHistoryService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-cache')
  list(@Query(new ZodPipe(ListProductsQuery)) q: ListProductsDto) {
    return this.catalogue.list(q);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-cache')
  get(@Param('id') id: string) {
    return this.catalogue.getDetails(id);
  }

  @Get(':id/price-history')
  @Header('Cache-Control', 'private, no-cache')
  getPriceHistory(
    @Param('id') id: string,
    @Query(new ZodPipe(PriceHistoryQuery)) q: PriceHistoryDto,
  ) {
    return this.priceHistory.get(id, q);
  }
}
