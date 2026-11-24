import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../common/auth.types';
import { Idempotent } from '../common/idempotency';
import { ZodPipe } from '../common/zod.pipe';
import { AddCartItemDto, AddCartItemSchema, UpdateCartItemDto, UpdateCartItemSchema } from './cart.schemas';
import { CartService } from './cart.service';

@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.cart.getMyCart(user.id);
  }

  @Idempotent()
  @Post('items')
  add(@CurrentUser() user: AuthUser, @Body(new ZodPipe(AddCartItemSchema)) dto: AddCartItemDto) {
    return this.cart.addItem(user.id, dto);
  }

  @Patch('items/:productId')
  setQuantity(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Body(new ZodPipe(UpdateCartItemSchema)) dto: UpdateCartItemDto,
  ) {
    return this.cart.setQuantity(user.id, productId, dto);
  }

  @Delete('items/:productId')
  remove(@CurrentUser() user: AuthUser, @Param('productId') productId: string) {
    return this.cart.removeItem(user.id, productId);
  }
}