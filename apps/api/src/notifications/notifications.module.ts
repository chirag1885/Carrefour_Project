import { Module } from '@nestjs/common';
import { NotificationsController,PreferencesController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { DbModule } from '../db/db.module';
@Module({imports:[DbModule],controllers:[NotificationsController,PreferencesController],providers:[NotificationsService]})
export class NotificationsModule {}
