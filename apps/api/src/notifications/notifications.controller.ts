import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../common/auth.types';
import { ZodPipe } from '../common/zod.pipe';
import { ListNotificationsDto, ListNotificationsQuery } from './notifications.schemas';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(ListNotificationsQuery)) q: ListNotificationsDto) {
    return this.notifications.list(user.id, q);
  }

  /** Cheap count for the bell badge (not in the original OpenAPI draft: additive). */
  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.id);
  }

  @HttpCode(204)
  @Post('read-all')
  async readAll(@CurrentUser() user: AuthUser): Promise<void> {
    await this.notifications.markAllRead(user.id);
  }

  @HttpCode(204)
  @Post(':id/read')
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.notifications.markRead(user.id, id);
  }

  @HttpCode(204)
  @Post(':id/click')
  async click(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.notifications.recordClick(user.id, id);
  }
}