import { Module } from '@nestjs/common';
import { AdminProductsController } from './admin-products.controller';
import { AdminSimulatorController } from './admin-simulator.controller';
import { SimulatorStateService } from './simulator-state.service';
import { PriceWriteService } from './price-write.service';
import { StockWriteService } from './stock-write.service';

// DbModule is registered globally in AppModule, so DbService is injectable here without an import.
@Module({
  controllers: [AdminProductsController, AdminSimulatorController],
  providers: [PriceWriteService, StockWriteService, SimulatorStateService],
  exports: [PriceWriteService, StockWriteService, SimulatorStateService],
})
export class AdminModule {}
