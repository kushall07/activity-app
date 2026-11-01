import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@activity/shared';
import { Public } from '../auth/decorators.js';
import { HealthService } from './health.service.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness probe for the ALB / ECS. */
  @Get()
  live(): HealthResponse {
    return this.health.liveness();
  }

  /** Readiness: 200 when all dependencies are up, 503 (same body shape) otherwise. */
  @Get('ready')
  async ready(): Promise<HealthResponse> {
    const result = await this.health.readiness();
    if (result.status !== 'ok') throw new ServiceUnavailableException(result);
    return result;
  }
}
