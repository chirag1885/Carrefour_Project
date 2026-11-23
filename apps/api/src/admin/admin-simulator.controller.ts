import { Body, Controller, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { SimulatorConfigDto, SimulatorConfigSchema } from './simulator.schemas';
import { SimulatorStateService } from './simulator-state.service';

/**
 * Controls the live price simulator worker.
 * State lives in Redis (simulator:state); the worker polls it every second.
 * Rate is capped at 50 eventsPerSecond for Phase 3 (see Phase 3 doc, D-6).
 */
@Controller('admin/simulator')
@Roles('admin')
export class AdminSimulatorController {
  constructor(private readonly state: SimulatorStateService) {}

  @Post('start')
  start() {
    return this.state.start();
  }

  @Post('stop')
  stop() {
    return this.state.stop();
  }

  @Post('config')
  config(@Body(new ZodPipe(SimulatorConfigSchema)) dto: SimulatorConfigDto) {
    return this.state.configure(dto);
  }
}
