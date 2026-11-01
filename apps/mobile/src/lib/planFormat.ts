import type { CostSplit, Plan, RequestStatus, SkillLevel } from '@activity/shared';

/** Plans are in Bengaluru, so times are always shown in IST, whatever the phone's zone. */
const IST_OFFSET_MS = 330 * 60_000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ist = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS);

/** Midnight IST of the given instant's day, as a UTC instant. */
export function istDayStart(d: Date): Date {
  const local = ist(d);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - IST_OFFSET_MS,
  );
}

/** An instant from an IST day and minutes after midnight. */
export function atIstMinutes(day: Date, minutes: number): Date {
  return new Date(istDayStart(day).getTime() + minutes * 60_000);
}

export function formatClock(d: Date): string {
  const local = ist(d);
  const h = local.getUTCHours();
  const m = local.getUTCMinutes();
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "Today", "Tomorrow" or "Sat 2 Nov". */
export function formatDay(d: Date, now = new Date()): string {
  const diffDays = Math.round(
    (istDayStart(d).getTime() - istDayStart(now).getTime()) / (24 * 3600_000),
  );
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  const local = ist(d);
  return `${DAYS[local.getUTCDay()]} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}`;
}

/** "Tomorrow, 7:00 pm". */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return `${formatDay(d, now)}, ${formatClock(d)}`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const GENDER_PLURAL = { woman: 'women', man: 'men', nonbinary: 'non-binary people' } as const;

/** "Looking for 2 women" / "Looking for 1 person" / "2 women, 2 men". */
export function formatWho(plan: Pick<Plan, 'seats' | 'wantedGenders' | 'genderMix'>): string {
  if (plan.genderMix) {
    return Object.entries(plan.genderMix)
      .filter(([, n]) => (n ?? 0) > 0)
      .map(([g, n]) => `${n} ${n === 1 ? g : GENDER_PLURAL[g as keyof typeof GENDER_PLURAL]}`)
      .join(', ');
  }
  const n = plan.seats.open;
  if (plan.wantedGenders.length === 1) {
    const g = plan.wantedGenders[0]!;
    return `${n} ${n === 1 ? (g === 'nonbinary' ? 'non-binary person' : g) : GENDER_PLURAL[g]}`;
  }
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

export function formatSeats(plan: Pick<Plan, 'seats'>): string {
  const { open, total } = plan.seats;
  if (open === 0) return 'Full';
  return open === total ? `${open} ${open === 1 ? 'seat' : 'seats'}` : `${open} of ${total} left`;
}

export const COST_SPLIT_LABEL: Record<CostSplit, string> = {
  free: 'Free',
  host_pays: 'Host pays',
  split_equally: 'Split equally',
  each_pays_own: 'Each pays their own',
};

export function formatCost(plan: Pick<Plan, 'costSplit' | 'costPerPersonInr'>): string {
  if (plan.costSplit === 'free') return 'Free';
  if (plan.costSplit === 'host_pays') return 'Host pays';
  const amount =
    plan.costPerPersonInr === null
      ? ''
      : ` · ₹${plan.costPerPersonInr.toLocaleString('en-IN')} each`;
  return `${COST_SPLIT_LABEL[plan.costSplit]}${amount}`;
}

export const SKILL_LABEL: Record<SkillLevel, string> = {
  any: 'Any level',
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const INTENT_LABEL = {
  date: 'Open to a date',
  friends: 'Just friends',
  either: 'Date or friends',
} as const;

export function formatDistance(km: number | null): string | null {
  if (km === null) return null;
  return km < 1 ? `${Math.max(Math.round(km * 10) * 100, 100)} m` : `${km.toFixed(1)} km`;
}

const DAY_MS = 24 * 3600_000;

export type When = 'any' | 'today' | 'tomorrow' | 'weekend';

/** Start/end of a "when" filter, in IST days. */
export function whenRange(when: When, now = new Date()): { from?: string; to?: string } {
  if (when === 'any') return {};
  const today = istDayStart(now).getTime();
  if (when === 'today') return { to: new Date(today + DAY_MS - 1).toISOString() };
  if (when === 'tomorrow') {
    return {
      from: new Date(today + DAY_MS).toISOString(),
      to: new Date(today + 2 * DAY_MS - 1).toISOString(),
    };
  }
  // Weekend: Saturday 00:00 to Sunday 23:59 IST (today, if it is the weekend).
  const istDay = new Date(today + 330 * 60_000).getUTCDay();
  const daysToSat = istDay === 0 ? -1 : 6 - istDay;
  const sat = today + daysToSat * DAY_MS;
  return {
    from: new Date(Math.max(sat, now.getTime())).toISOString(),
    to: new Date(sat + 2 * DAY_MS - 1).toISOString(),
  };
}

/** How a member's own request reads. A decline is phrased gently on purpose. */
export const REQUEST_LABEL: Record<RequestStatus, string> = {
  pending: 'Requested',
  accepted: "You're in",
  declined: 'Not this time',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
  cancelled: 'Plan cancelled',
};
