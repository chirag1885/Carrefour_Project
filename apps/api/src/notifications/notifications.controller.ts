import { Body,Controller,Get,HttpCode,Param,Post,Put,Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../common/auth.types';
import { ZodPipe } from '../common/zod.pipe';
import { z } from 'zod';
import { FeedQuery,PreferencesSchema,type PreferencesDto } from './notifications.schemas';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service:NotificationsService) {}
  @Get()
  list(@CurrentUser() user:AuthUser,@Query(new ZodPipe(FeedQuery)) query:z.infer<typeof FeedQuery>) {
    return this.service.list(user.id,query);
  }
  @Get('unread-count')
  count(@CurrentUser() user:AuthUser) {return this.service.unreadCount(user.id);}
  @Post('read-all') @HttpCode(204)
  readAll(@CurrentUser() user:AuthUser) {return this.service.readAll(user.id);}
  @Post(':id/read') @HttpCode(204)
  read(@CurrentUser() user:AuthUser,@Param('id') id:string) {return this.service.read(user.id,id);}
  @Post(':id/click') @HttpCode(204)
  click(@CurrentUser() user:AuthUser,@Param('id') id:string) {return this.service.click(user.id,id);}
}

@Controller('me/preferences')
export class PreferencesController {
  constructor(private readonly service:NotificationsService) {}
  @Get()
  get(@CurrentUser() user:AuthUser) {return this.service.preferences(user.id);}
  @Put()
  put(@CurrentUser() user:AuthUser,@Body(new ZodPipe(PreferencesSchema)) dto:PreferencesDto) {
    return this.service.replacePreferences(user.id,dto);
  }
}
