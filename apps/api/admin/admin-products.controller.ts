import { Body, Controller, Header, Param, Put } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../common/auth.types';
import { notFound } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { isProductId, SetPriceDto, SetPriceSchema, SetStockDto, SetStockSchema } from './admin-products.schemas';
import { PriceWriteService } from './price-write.service';
import { StockWriteService } from './stock-write.service';

/** A malformed id can never match a product, so it is a 404 (same as the catalogue). */
const requireProductId = (id: string): string => {
  if (!isProductId(id)) throw notFound('PRODUCT_NOT_FOUND', 'Product not found');
  return id;
};

// JwtAuthGuard authenticates, then RolesGuard checks this class-level role: customers get 403.
@Controller('admin/products')
@Roles('admin')
export class AdminProductsController {
  constructor(
    private readonly prices: PriceWriteService,
    private readonly stock: StockWriteService,
  ) {}

  @Put(':id/price')
  @Header('Cache-Control', 'no-store')
  setPrice(
    @Param('id') id: string,
    @Body(new ZodPipe(SetPriceSchema)) dto: SetPriceDto,
    @CurrentUser() admin: AuthUser,
  ) {
    return this.prices.setPrice(requireProductId(id), dto, admin.id);
  }

  @Put(':id/stock')
  @Header('Cache-Control', 'no-store')
  setStock(
    @Param('id') id: string,
    @Body(new ZodPipe(SetStockSchema)) dto: SetStockDto,
    @CurrentUser() admin: AuthUser,
  ) {
    return this.stock.setStock(requireProductId(id), dto, admin.id);
  }
}
