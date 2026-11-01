import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { DevicesService } from './devices.service.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';

@Module({
  imports: [PlansModule, ChatModule],
  controllers: [RequestsController],
  providers: [RequestsService, DevicesService],
})
export class RequestsModule {}
