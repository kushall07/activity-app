import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module.js';
import { CatalogService } from './catalog.service.js';
import { FeedService } from './feed.service.js';
import { PlansController } from './plans.controller.js';
import { PlansService } from './plans.service.js';
import { SearchModule } from './search.module.js';
import { ViewerService } from './viewer.service.js';

@Module({
  imports: [SearchModule, ChatModule],
  controllers: [PlansController],
  providers: [PlansService, FeedService, CatalogService, ViewerService],
  exports: [PlansService, ViewerService],
})
export class PlansModule {}
