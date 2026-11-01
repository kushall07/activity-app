import { BENGALURU_AREAS, REQUEST_RULES, SCORE_WEIGHTS } from '@activity/shared';

type Level = 'any' | 'beginner' | 'intermediate' | 'advanced';
type Intent = 'date' | 'friends' | 'either';

export interface ScorePlan {
  activitySlug: string;
  activityName: string;
  lat: number;
  lng: number;
  skillLevel: Level;
  intent: Intent;
}

export interface ScoreRequester {
  neighbourhood: string | null;
  interests: string[];
  intent: Intent;
  verified: boolean;
  /** Level the requester gave for this activity, if any. */
  skillLevel: Exclude<Level, 'any'> | null;
  joinedAt: Date;
}

export interface MatchScore {
  /** 0-100. */
  score: number;
  /** Up to three short, positive reasons for the host. */
  reasons: string[];
}

const LEVELS: Exclude<Level, 'any'>[] = ['beginner', 'intermediate', 'advanced'];
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function areaOf(neighbourhood: string | null) {
  if (!neighbourhood) return null;
  const n = neighbourhood.trim().toLowerCase();
  return BENGALURU_AREAS.find((a) => a.name.toLowerCase() === n) ?? null;
}

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Ranks people asking to join a plan (the host's request stack). Hard filters
 * have already passed; this only orders what is left. Weights follow the plan
 * doc and are deliberately simple, explainable and cheap: a learned model
 * replaces them once there are a few thousand completed meetups.
 */
export function scoreRequest(
  plan: ScorePlan,
  who: ScoreRequester,
  now: Date = new Date(),
): MatchScore {
  const reasons: { text: string; weight: number }[] = [];

  // Distance from the member's neighbourhood to the plan. Bengaluru traffic makes
  // 3 km and 15 km very different evenings: full marks within 3 km, none past 20 km.
  let distance = 0.5;
  const area = areaOf(who.neighbourhood);
  if (area) {
    const km = haversineKm(area, plan);
    distance = clamp01(1 - (km - 3) / 17);
    if (km <= 5)
      reasons.push({ text: `Lives nearby (${area.name})`, weight: SCORE_WEIGHTS.distance });
  }

  // Activity fit: stated level against the plan's level, plus the activity in their interests.
  let level = 0.5;
  if (plan.skillLevel !== 'any' && who.skillLevel) {
    const gap = Math.abs(LEVELS.indexOf(plan.skillLevel) - LEVELS.indexOf(who.skillLevel));
    level = gap === 0 ? 1 : gap === 1 ? 0.4 : 0;
    if (gap === 0)
      reasons.push({ text: `Also ${who.skillLevel}`, weight: SCORE_WEIGHTS.activityFit });
  } else if (plan.skillLevel === 'any') {
    level = 0.75;
  }
  const wanted = [normalise(plan.activitySlug), normalise(plan.activityName)];
  const interested = who.interests.some((i) => {
    const n = normalise(i);
    return n.length > 0 && wanted.some((w) => w === n || w.includes(n) || n.includes(w));
  });
  if (interested) {
    reasons.push({
      text: `Into ${plan.activityName.toLowerCase()}`,
      weight: SCORE_WEIGHTS.activityFit - 1,
    });
  }
  const activityFit = 0.6 * level + 0.4 * (interested ? 1 : 0);

  // Trust: the verified badge for now; show-up rate and ratings join in milestone 6.
  const trust = who.verified ? 1 : 0.3;
  if (who.verified) reasons.push({ text: 'Photo verified', weight: SCORE_WEIGHTS.trust - 2 });

  // Intent: same intent is best, "either" is fine, date vs friends is a mismatch.
  let intent: number;
  if (who.intent === plan.intent && plan.intent !== 'either') {
    intent = 1;
    reasons.push({
      text: plan.intent === 'date' ? 'Also open to a date' : 'Also here for friends',
      weight: SCORE_WEIGHTS.intent,
    });
  } else if (who.intent === 'either' || plan.intent === 'either') {
    intent = 0.7;
  } else {
    intent = 0;
  }

  // Fairness: a short boost for new members so they get early matches.
  const days = (now.getTime() - who.joinedAt.getTime()) / 86_400_000;
  const freshness = days <= REQUEST_RULES.newMemberDays ? 1 : 0.4;
  if (days <= REQUEST_RULES.newMemberDays) {
    reasons.push({ text: 'New here', weight: SCORE_WEIGHTS.freshness - 5 });
  }

  const total = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
  const raw =
    SCORE_WEIGHTS.distance * distance +
    SCORE_WEIGHTS.activityFit * activityFit +
    SCORE_WEIGHTS.trust * trust +
    SCORE_WEIGHTS.intent * intent +
    SCORE_WEIGHTS.freshness * freshness;

  return {
    score: Math.round((raw / total) * 100),
    reasons: reasons
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((r) => r.text),
  };
}
