import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  blockRequestSchema,
  createRequestSchema,
  registerDeviceSchema,
  type MyRequestsResponse,
  type PlanRequestsResponse,
  type RequestDecisionResponse,
} from '@activity/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DevicesService } from './devices.service.js';
import { RequestsService } from './requests.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

@Controller()
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly devices: DevicesService,
  ) {}

  /** "I'm in". */
  @Post('plans/:id/requests')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) planId: string,
    @Body(new ZodPipe(createRequestSchema)) body: z.output<typeof createRequestSchema>,
  ): Promise<RequestDecisionResponse> {
    return this.requests.create(user.id, planId, body);
  }

  /** Host only: the request stack and who is in. */
  @Get('plans/:id/requests')
  forPlan(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) planId: string,
  ): Promise<PlanRequestsResponse> {
    return this.requests.forPlan(user.id, planId);
  }

  @Post('requests/:id/accept')
  @HttpCode(200)
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<RequestDecisionResponse> {
    return this.requests.accept(user.id, id);
  }

  @Post('requests/:id/decline')
  @HttpCode(200)
  decline(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<RequestDecisionResponse> {
    return this.requests.decline(user.id, id);
  }

  /** The requester takes back a waiting request, or leaves a plan they were accepted on. */
  @Post('requests/:id/withdraw')
  @HttpCode(200)
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<RequestDecisionResponse> {
    return this.requests.withdraw(user.id, id);
  }

  @Get('me/requests')
  async mine(@CurrentUser() user: AuthUser): Promise<MyRequestsResponse> {
    return { requests: await this.requests.mine(user.id) };
  }

  @Post('blocks')
  @HttpCode(204)
  async block(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(blockRequestSchema)) body: z.output<typeof blockRequestSchema>,
  ): Promise<void> {
    await this.requests.block(user.id, body.userId);
  }

  @Delete('blocks/:userId')
  @HttpCode(204)
  async unblock(
    @CurrentUser() user: AuthUser,
    @Param('userId', uuid) otherId: string,
  ): Promise<void> {
    await this.requests.unblock(user.id, otherId);
  }

  /** Registers this install for push. Called after sign-in and whenever the OS rotates the token. */
  @Put('me/devices')
  @HttpCode(204)
  async registerDevice(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(registerDeviceSchema)) body: z.output<typeof registerDeviceSchema>,
  ): Promise<void> {
    await this.devices.register(user.id, body);
  }

  /** Called on sign-out so the next person on this phone does not get the previous member's pushes. */
  @Post('me/devices/remove')
  @HttpCode(204)
  async removeDevice(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(registerDeviceSchema)) body: z.output<typeof registerDeviceSchema>,
  ): Promise<void> {
    await this.devices.remove(user.id, body.token);
  }
}
