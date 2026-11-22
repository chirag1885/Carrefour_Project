import { Module } from '@nestjs/common';
import { CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';
import { ProductCacheService } from './product-cache.service';

@Module({ controllers: [CatalogueController], providers: [CatalogueService, ProductCacheService] })
export class CatalogueModule {}
