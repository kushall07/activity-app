/**
 * Local demo data: a few sample venues and hosts with upcoming plans, so the
 * Explore feed is not empty on a fresh machine. Refuses to run in production.
 *
 *   pnpm db:seed
 *
 * Re-running is safe: sample rows are matched by name/phone and plans are only
 * added for hosts that have none upcoming.
 */
import pg from 'pg';
import { resolveDatabaseUrl } from '@activity/db';

const VENUES = [
  {
    name: 'Sample: Koramangala Shuttle Club',
    area: 'Koramangala',
    lat: 12.9339,
    lng: 77.6229,
    activities: ['badminton', 'table-tennis', 'squash'],
  },
  {
    name: 'Sample: Indiranagar Comedy Room',
    area: 'Indiranagar',
    lat: 12.9784,
    lng: 77.6408,
    activities: ['comedy', 'concert'],
  },
  {
    name: 'Sample: HSR Clay Studio',
    area: 'HSR Layout',
    lat: 12.9121,
    lng: 77.6446,
    activities: ['pottery', 'painting'],
  },
  {
    name: 'Sample: Church Street Board Game Cafe',
    area: 'MG Road',
    lat: 12.9749,
    lng: 77.6061,
    activities: ['board-games', 'quiz-night', 'coffee'],
  },
  {
    name: 'Sample: Cubbon Park Bandstand',
    area: 'MG Road',
    lat: 12.9763,
    lng: 77.5929,
    activities: ['walk', 'running', 'photo-walk'],
  },
];

const HOSTS = [
  { phone: '+919000000001', name: 'Ananya', birth: '1996-04-12', gender: 'woman' },
  { phone: '+919000000002', name: 'Rohan', birth: '1993-08-30', gender: 'man' },
  { phone: '+919000000003', name: 'Kavya', birth: '1998-01-21', gender: 'woman' },
];

const PLANS = [
  {
    host: 0,
    activity: 'badminton',
    venue: 0,
    inHours: 26,
    seats: 3,
    genders: ['woman', 'man'],
    cost: 'split_equally',
    inr: 250,
    note: 'Doubles, intermediate. I will book the court.',
  },
  {
    host: 1,
    activity: 'comedy',
    venue: 1,
    inHours: 50,
    seats: 1,
    genders: ['woman'],
    cost: 'each_pays_own',
    inr: 599,
    note: 'Open mic night, front rows.',
  },
  {
    host: 2,
    activity: 'pottery',
    venue: 2,
    inHours: 74,
    seats: 2,
    genders: ['woman', 'man', 'nonbinary'],
    cost: 'each_pays_own',
    inr: 1500,
    note: 'Beginner wheel session.',
  },
  {
    host: 0,
    activity: 'board-games',
    venue: 3,
    inHours: 30,
    seats: 3,
    genders: ['woman', 'man'],
    cost: 'each_pays_own',
    inr: null,
    note: 'Catan and Codenames.',
  },
  {
    host: 1,
    activity: 'running',
    venue: 4,
    inHours: 15,
    seats: 4,
    genders: ['woman', 'man'],
    cost: 'free',
    inr: 0,
    note: '5 km easy pace, meet at the bandstand.',
  },
  {
    host: 2,
    activity: 'coffee',
    venue: 3,
    inHours: 20,
    seats: 1,
    genders: ['man'],
    cost: 'each_pays_own',
    inr: 300,
    note: '',
  },
];

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('db:seed is for local development only');
  const pool = new pg.Pool({ connectionString: resolveDatabaseUrl(process.env) });
  try {
    const venueIds: string[] = [];
    for (const v of VENUES) {
      const { rows } = await pool.query(
        `insert into venues (name, area, address, location, activity_slugs)
         select $1, $2, null, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5
         where not exists (select 1 from venues where name = $1)
         returning id`,
        [v.name, v.area, v.lat, v.lng, v.activities],
      );
      venueIds.push(
        rows[0]?.id ??
          (await pool.query('select id from venues where name = $1', [v.name])).rows[0].id,
      );
    }

    const hostIds: string[] = [];
    for (const h of HOSTS) {
      const { rows } = await pool.query(
        `insert into users (phone_e164) values ($1)
         on conflict (phone_e164) do update set phone_e164 = excluded.phone_e164 returning id`,
        [h.phone],
      );
      const id = rows[0].id as string;
      hostIds.push(id);
      await pool.query(
        `insert into profiles (user_id, display_name, birth_date, gender, verified_at, neighbourhood)
         values ($1, $2, $3, $4, now(), 'Koramangala') on conflict (user_id) do nothing`,
        [id, h.name, h.birth, h.gender],
      );
    }

    let added = 0;
    for (const p of PLANS) {
      const hostId = hostIds[p.host]!;
      const { rows: existing } = await pool.query(
        `select 1 from plans where host_id = $1 and activity_slug = $2 and status = 'open' and starts_at > now()`,
        [hostId, p.activity],
      );
      if (existing.length) continue;
      const v = VENUES[p.venue]!;
      await pool.query(
        `insert into plans (host_id, activity_slug, venue_id, place_name, area, location, starts_at,
           duration_minutes, seats_total, wanted_genders, cost_split, cost_per_person_inr, note)
         values ($1, $2, $3, $4, $5, (select location from venues where id = $3),
           date_trunc('hour', now()) + make_interval(hours => $6), 120, $7, $8::gender[], $9, $10, $11)`,
        [
          hostId,
          p.activity,
          venueIds[p.venue],
          v.name,
          v.area,
          p.inHours,
          p.seats,
          p.genders,
          p.cost,
          p.inr,
          p.note,
        ],
      );
      added++;
    }
    console.log(
      `Seeded ${VENUES.length} sample venues, ${HOSTS.length} hosts and ${added} new plans.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
