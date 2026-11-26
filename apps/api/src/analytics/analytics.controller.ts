import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ActivityDto, ActivityQuery, OverviewDto, OverviewQuery } from './analytics.schemas';
import { AnalyticsService } from './analytics.service';

@Controller('admin')
@Roles('admin')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('analytics/overview')
  overview(@Query(new ZodPipe(OverviewQuery)) q: OverviewDto) {
    return this.analytics.overview(q.days);
  }

  @Get('system/health')
  health() {
    return this.analytics.health();
  }

  @Get('activity')
  activity(@Query(new ZodPipe(ActivityQuery)) q: ActivityDto) {
    return this.analytics.activity(q.limit);
  }
}