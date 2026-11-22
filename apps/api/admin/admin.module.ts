import { Module } from '@nestjs/common';
import { AdminProductsController } from './admin-products.controller';
import { PriceWriteService } from './price-write.service';
import { StockWriteService } from './stock-write.service';

// DbModule is registered globally in AppModule, so DbService is injectable here without an import.
@Module({
  controllers: [AdminProductsController],
  providers: [PriceWriteService, StockWriteService],
  exports: [PriceWriteService, StockWriteService],
})
export class AdminModule {}
