import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser, Public } from '../auth/decorators';
import type { AuthUser } from '../common/auth.types';
import { Idempotent } from '../common/idempotency';
import { ZodPipe } from '../common/zod.pipe';
import { CopyWishlistDto, CopyWishlistSchema, ShareOptionsDto, ShareOptionsSchema } from './sharing.schemas';
import { SharingService } from './sharing.service';

@Controller()
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Idempotent()
  @Post('wishlists/:id/share')
  create(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ShareOptionsSchema)) dto: ShareOptionsDto) {
    return this.sharing.createShare(user.id, id, dto);
  }

  @Public()
  @Get('shared/:token')
  view(@Param('token') token: string) {
    return this.sharing.view(token);
  }

  @Idempotent()
  @Post('shared/:token/copy')
  copy(@CurrentUser() user: AuthUser, @Param('token') token: string, @Body(new ZodPipe(CopyWishlistSchema)) dto: CopyWishlistDto) {
    return this.sharing.copy(user.id, token, dto);
  }
}