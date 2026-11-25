import { Controller, Get, Header, Param } from '@nestjs/common';
import { InsightsService } from './insights.service';

@Controller('products')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get(':id/prediction')
  @Header('Cache-Control', 'private, no-cache')
  prediction(@Param('id') id: string) {
    return this.insights.prediction(id);
  }

  @Get(':id/similar')
  @Header('Cache-Control', 'private, no-cache')
  similar(@Param('id') id: string) {
    return this.insights.similar(id);
  }
}