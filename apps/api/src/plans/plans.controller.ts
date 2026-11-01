import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createPlanRequestSchema,
  feedQuerySchema,
  latLngSchema,
  myPlansQuerySchema,
  updatePlanRequestSchema,
  venueSearchQuerySchema,
  type ActivitiesResponse,
  type FeedResponse,
  type Plan,
  type VenuesResponse,
} from '@activity/shared';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CatalogService } from './catalog.service.js';
import { FeedService } from './feed.service.js';
import { PlansService } from './plans.service.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Optional `lat`/`lng` on plan details, to show the distance. */
const originQuerySchema = z
  .object({ lat: z.coerce.number().optional(), lng: z.coerce.number().optional() })
  .transform((q) =>
    q.lat !== undefined && q.lng !== undefined && latLngSchema.safeParse(q).success
      ? { lat: q.lat, lng: q.lng }
      : undefined,
  );

@Controller()
export class PlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly feed: FeedService,
    private readonly catalog: CatalogService,
  ) {}

  @Get('activities')
  @Header('cache-control', 'private, max-age=3600')
  async activities(): Promise<ActivitiesResponse> {
    return { activities: await this.catalog.activities() };
  }

  @Get('venues')
  async venues(
    @Query(new ZodPipe(venueSearchQuerySchema)) q: z.output<typeof venueSearchQuerySchema>,
  ): Promise<VenuesResponse> {
    return { venues: await this.catalog.venues(q) };
  }

  /** The Explore feed: plans near a point that this member can join. */
  @Get('plans')
  explore(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(feedQuerySchema)) q: z.output<typeof feedQuerySchema>,
  ): Promise<FeedResponse> {
    return this.feed.feed(user.id, q);
  }

  @Post('plans')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createPlanRequestSchema)) body: z.output<typeof createPlanRequestSchema>,
  ): Promise<Plan> {
    return this.plans.create(user.id, body);
  }

  @Get('plans/:id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Query(new ZodPipe(originQuerySchema)) origin: z.output<typeof originQuerySchema>,
  ): Promise<Plan> {
    return this.plans.get(user.id, id, origin);
  }

  @Patch('plans/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(updatePlanRequestSchema)) body: z.output<typeof updatePlanRequestSchema>,
  ): Promise<Plan> {
    return this.plans.update(user.id, id, body);
  }

  @Post('plans/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<Plan> {
    return this.plans.cancel(user.id, id);
  }

  @Get('me/plans')
  async mine(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(myPlansQuerySchema)) q: z.output<typeof myPlansQuerySchema>,
  ): Promise<{ plans: Plan[] }> {
    return { plans: await this.plans.mine(user.id, q.scope) };
  }
}
