import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { FeedService } from './feed.service.js';
import { PlansController } from './plans.controller.js';
import { PlansService } from './plans.service.js';
import { SearchModule } from './search.module.js';
import { ViewerService } from './viewer.service.js';

@Module({
  imports: [SearchModule],
  controllers: [PlansController],
  providers: [PlansService, FeedService, CatalogService, ViewerService],
})
export class PlansModule {}
