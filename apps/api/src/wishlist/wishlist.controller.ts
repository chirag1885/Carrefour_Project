import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../common/auth.types';
import { Idempotent } from '../common/idempotency';
import { ZodPipe } from '../common/zod.pipe';
import {
  AddItemDto, AddItemSchema, ListItemsDto, ListItemsQuery, MoveOptionsDto, MoveOptionsSchema,
  UpdateItemDto, UpdateItemSchema, WishlistNameDto, WishlistNameSchema,
} from './wishlist.schemas';
import { WishlistService } from './wishlist.service';

@Controller('wishlists')
export class WishlistController {
  constructor(private readonly wishlists: WishlistService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.wishlists.list(user.id);
  }

  @Idempotent()
  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(WishlistNameSchema)) dto: WishlistNameDto) {
    return this.wishlists.create(user.id, dto.name);
  }

  @Patch(':id')
  rename(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(WishlistNameSchema)) dto: WishlistNameDto) {
    return this.wishlists.rename(user.id, id, dto.name);
  }

  @HttpCode(204)
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.wishlists.remove(user.id, id);
  }

  @Get(':id/items')
  items(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query(new ZodPipe(ListItemsQuery)) q: ListItemsDto) {
    return this.wishlists.listItems(user.id, id, q);
  }
    @Get('membership')
  membership(@CurrentUser() user: AuthUser) {
    return this.wishlists.membership(user.id);
  }

  @Idempotent()
  @Post(':id/items')
  addItem(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(AddItemSchema)) dto: AddItemDto) {
    return this.wishlists.addItem(user.id, id, dto);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @CurrentUser() user: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string,
    @Body(new ZodPipe(UpdateItemSchema)) dto: UpdateItemDto,
  ) {
    return this.wishlists.updateItem(user.id, id, itemId, dto);
  }

  @HttpCode(204)
  @Delete(':id/items/:itemId')
  async removeItem(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string): Promise<void> {
    await this.wishlists.removeItem(user.id, id, itemId);
  }

  @Idempotent()
  @HttpCode(200)
  @Post(':id/items/:itemId/move-to-cart')
  moveToCart(
    @CurrentUser() user: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string,
    @Body(new ZodPipe(MoveOptionsSchema)) opts: MoveOptionsDto,
  ) {
    return this.wishlists.moveItemToCart(user.id, id, itemId, opts);
  }

  @Idempotent()
  @HttpCode(200)
  @Post(':id/move-all-to-cart')
  moveAllToCart(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.wishlists.moveAllToCart(user.id, id);
  }

  @Get(':id/trends')
  trends(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.wishlists.trends(user.id, id);
  }
}