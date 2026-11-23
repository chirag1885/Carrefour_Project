import { Module } from '@nestjs/common';
import { CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';
import { PriceHistoryService } from './price-history.service';
import { ProductCacheService } from './product-cache.service';

@Module({ controllers: [CatalogueController], providers: [CatalogueService, ProductCacheService, PriceHistoryService] })
export class CatalogueModule {}
