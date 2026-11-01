import type {
  Activity,
  CostSplit,
  CreatePlanRequest,
  Plan,
  SkillLevel,
  Venue,
} from '@activity/shared';
import { atIstMinutes, istDayStart } from './planFormat';

export type Gender = 'woman' | 'man' | 'nonbinary';
export type Intent = 'date' | 'friends' | 'either';

/** The Post flow's form state. */
export interface Draft {
  activity: Activity | null;
  day: number; // IST midnight, epoch ms
  minutes: number; // after midnight
  duration: number;
  placeMode: 'venue' | 'custom';
  venue: Pick<Venue, 'id' | 'name' | 'area'> | null;
  placeName: string;
  area: string;
  seats: number;
  genders: Gender[];
  ageMin: number;
  ageMax: number;
  skill: SkillLevel;
  intent: Intent;
  verifiedOnly: boolean;
  costSplit: CostSplit;
  cost: string;
  note: string;
}

export function emptyDraft(now = new Date()): Draft {
  return {
    activity: null,
    day: istDayStart(new Date(now.getTime() + 3 * 3600_000)).getTime(),
    minutes: 19 * 60,
    duration: 90,
    placeMode: 'custom',
    venue: null,
    placeName: '',
    area: 'Koramangala',
    seats: 1,
    genders: ['woman', 'man'],
    ageMin: 18,
    ageMax: 45,
    skill: 'any',
    intent: 'either',
    verifiedOnly: false,
    costSplit: 'each_pays_own',
    cost: '',
    note: '',
  };
}

export function draftFromPlan(p: Plan): Draft {
  const start = new Date(p.startsAt);
  const day = istDayStart(start).getTime();
  return {
    activity: p.activity,
    day,
    minutes: Math.round((start.getTime() - day) / 60_000),
    duration: p.durationMinutes,
    placeMode: p.place.venueId ? 'venue' : 'custom',
    venue: p.place.venueId ? { id: p.place.venueId, name: p.place.name, area: p.place.area } : null,
    placeName: p.place.venueId ? '' : p.place.name,
    area: p.place.area,
    seats: p.seats.total,
    genders: p.wantedGenders,
    ageMin: p.ageMin,
    ageMax: p.ageMax,
    skill: p.skillLevel,
    intent: p.intent,
    verifiedOnly: p.verifiedOnly,
    costSplit: p.costSplit,
    cost: p.costPerPersonInr ? String(p.costPerPersonInr) : '',
    note: p.note,
  };
}

/** The request body for a draft (the activity is required for create only). */
export function toRequest(d: Draft): CreatePlanRequest {
  const cost = d.cost.trim() ? Number(d.cost.replace(/[^\d]/g, '')) : null;
  return {
    activitySlug: d.activity?.slug ?? '',
    ...(d.placeMode === 'venue' && d.venue
      ? { venueId: d.venue.id, place: null }
      : { venueId: null, place: { name: d.placeName.trim(), area: d.area } }),
    startsAt: atIstMinutes(new Date(d.day), d.minutes).toISOString(),
    durationMinutes: d.duration,
    seatsTotal: d.seats,
    wantedGenders: d.genders,
    ageMin: d.ageMin,
    ageMax: d.ageMax,
    skillLevel: d.skill,
    intent: d.intent,
    costSplit: d.costSplit,
    costPerPersonInr: d.costSplit === 'free' || d.costSplit === 'host_pays' ? null : cost,
    verifiedOnly: d.verifiedOnly,
    note: d.note.trim(),
  };
}
