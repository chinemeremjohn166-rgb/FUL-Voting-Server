// Fills the development database with something worth looking at: logins that
// work, an election at every stage of its life, and counted ballots so the
// results page has real numbers.
//
//   node ./scripts/seed.ts                  add whatever fixture rows are missing
//   node ./scripts/seed.ts --reset-fixtures   rebuild only the elections listed below
//   node ./scripts/seed.ts --fresh          empty every table (destroys all data)
//
// The default run is meant to be harmless twice over: users are matched by
// email, elections by title, positions by title within an election, and a
// ballot is only written when that voter has not already cast one.
// `--reset-fixtures` deletes the rows under these four titles and nothing else,
// so the tallies below can be rebuilt without touching anyone else's elections.

// Must come before the db client: it installs the Temporal values Prisma 8 maps
// DateTime columns to.
import "../src/lib/temporal.ts";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { Temporal } from "temporal-polyfill";
import { db } from "../src/prisma/db.ts";

const FRESH = process.argv.includes("--fresh");
const RESET = process.argv.includes("--reset-fixtures");

/** An Instant `hours` away from now (negative for the past). */
const hoursFromNow = (hours: number): Temporal.Instant =>
  Temporal.Now.instant().add(Temporal.Duration.from({ hours }));

/** The same shape the API issues, so the verify page accepts it. */
const receiptCode = (electionId: string): string =>
  `REC-${electionId.slice(0, 4).toUpperCase()}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

interface UserSpec {
  email: string;
  fullName: string;
  matricNo: string;
  role: "VOTER" | "ADMIN";
  password: string;
}

// Every password here satisfies the API's own rule (8-72 characters with an
// upper, a lower, a digit and a special character) and is printed at the end.
const USERS: UserSpec[] = [
  { email: "admin@voting.test", fullName: "Chief Electoral Officer", matricNo: "SCI/2020/001", role: "ADMIN", password: "Admin#2026" },
  { email: "ada@voting.test", fullName: "Ada Nwosu", matricNo: "SCI/2023/101", role: "VOTER", password: "Voter#2026" },
  { email: "bola@voting.test", fullName: "Bola Ade", matricNo: "SCI/2023/102", role: "VOTER", password: "Voter#2026" },
  { email: "chidi@voting.test", fullName: "Chidi Oke", matricNo: "SCI/2023/103", role: "VOTER", password: "Voter#2026" },
  { email: "dana@voting.test", fullName: "Dana Yusuf", matricNo: "SCI/2023/104", role: "VOTER", password: "Voter#2026" },
  { email: "eka@voting.test", fullName: "Eka Bright", matricNo: "SCI/2023/105", role: "VOTER", password: "Voter#2026" },
];

interface CandidateSpec {
  fullName: string;
  manifesto: string | null;
}

interface PositionSpec {
  title: string;
  seats: number;
  candidates: CandidateSpec[];
}

interface ElectionSpec {
  title: string;
  description: string;
  status: "DRAFT" | "OPEN" | "CLOSED" | "PUBLISHED";
  /** Voting window, in hours from now, so the fixture is never stale. */
  openHours: number;
  closeHours: number;
  positions: PositionSpec[];
  /** How many of the seeded voters already cast a ballot (0 for a draft). */
  turnout: number;
  /**
   * For each position, the candidate index each counting voter picks, cycling
   * through the list. `null` means that voter abstained from that position.
   */
  pick: (number | null)[];
}

const ELECTIONS: ElectionSpec[] = [
  {
    title: "Student Union Election 2027",
    description: "Still being configured: add positions, candidates and the roll before opening.",
    status: "DRAFT",
    openHours: 24 * 21,
    closeHours: 24 * 28,
    positions: [
      { title: "President", seats: 1, candidates: [{ fullName: "Femi Lawal", manifesto: "One canteen, one voice." }, { fullName: "Grace Ilori", manifesto: null }] },
      { title: "Welfare Officer", seats: 2, candidates: [{ fullName: "Hauwa Sadiq", manifesto: "Late-night clinic cover." }, { fullName: "Ian Peters", manifesto: null }, { fullName: "Jumoke Asin", manifesto: "Peer counselling rota." }] },
    ],
    turnout: 0,
    pick: [0, 1],
  },
  {
    title: "Club Council Refresh",
    description: "Open right now — cast a ballot from the Elections list to see the receipt flow.",
    status: "OPEN",
    openHours: -24,
    closeHours: 24 * 2,
    positions: [
      { title: "Social Convenor", seats: 1, candidates: [{ fullName: "Kemi Bright", manifesto: "A monthly film night." }, { fullName: "Leo Mota", manifesto: null }] },
      { title: "Games Captain", seats: 2, candidates: [{ fullName: "Mira Solt", manifesto: null }, { fullName: "Nnamdi Eze", manifesto: "Inter-hall football league." }] },
    ],
    turnout: 0,
    pick: [1, 0],
  },
  {
    title: "Hall of Fame Induction",
    description: "Voting has ended; results are counted but not yet published, so only administrators can see them.",
    status: "CLOSED",
    openHours: -24 * 10,
    closeHours: -24 * 3,
    positions: [
      { title: "Inductee of the Year", seats: 1, candidates: [{ fullName: "Oba Martins", manifesto: null }, { fullName: "Petra Danladi", manifesto: null }] },
    ],
    // Four of the five seeded voters took part; the fourth abstained.
    turnout: 4,
    pick: [0],
  },
  {
    title: "Library Representative By-Election",
    description: "Published: every user can read the tally and verify their own receipt.",
    status: "PUBLISHED",
    openHours: -24 * 20,
    closeHours: -24 * 14,
    positions: [
      { title: "Library Representative", seats: 1, candidates: [{ fullName: "Rafi Quaye", manifesto: "Extended weekend hours." }, { fullName: "Sia Wambugu", manifesto: "Silent-floor booking." }, { fullName: "Tomas Reyes", manifesto: null }] },
    ],
    turnout: 5,
    pick: [0],
  },
];

/** Wipes every table, children before parents, so the FKs do not object. */
async function emptyAll(): Promise<void> {
  // Listed one by one rather than as an array: each `where` lambda needs the
  // concrete table type to infer `row`.
  await db.orm.public.Vote.where((row) => row.id.isNotNull()).deleteAll();
  await db.orm.public.Ballot.where((row) => row.id.isNotNull()).deleteAll();
  await db.orm.public.VoterRoll.where((row) => row.id.isNotNull()).deleteAll();
  await db.orm.public.Candidate.where((row) => row.id.isNotNull()).deleteAll();
  await db.orm.public.Position.where((row) => row.id.isNotNull()).deleteAll();
  await db.orm.public.AuditLog.where((row) => row.id.isNotNull()).deleteAll();
  await db.orm.public.Election.where((row) => row.id.isNotNull()).deleteAll();
  await db.orm.public.User.where((row) => row.id.isNotNull()).deleteAll();
  console.log("All tables emptied.");
}

/** Deletes every row under the titles in ELECTIONS, and nothing outside them. */
async function resetFixtureElections(): Promise<void> {
  for (const spec of ELECTIONS) {
    const election = await db.orm.public.Election.where({ title: spec.title }).first();
    if (!election) continue;
    const electionId = election.id as string;

    const positions = await db.orm.public.Position.where({ electionId }).select("id").all();
    for (const position of positions) {
      await db.orm.public.Candidate.where({ positionId: position.id as string }).deleteAll();
    }
    await db.orm.public.Position.where({ electionId }).deleteAll();
    await db.orm.public.Vote.where({ electionId }).deleteAll();
    await db.orm.public.Ballot.where({ electionId }).deleteAll();
    await db.orm.public.VoterRoll.where({ electionId }).deleteAll();
    await db.orm.public.Election.where({ id: electionId }).deleteAll();
    console.log(`Removed the fixture election "${spec.title}".`);
  }
}

/** Creates the user if the email is new, and always returns its id. */
async function upsertUser(spec: UserSpec): Promise<string> {
  const existing = await db.orm.public.User.where({ email: spec.email }).first();
  if (existing) return existing.id as string;

  const salt = await bcrypt.genSalt(10);
  const created = await db.orm.public.User.create({
    email: spec.email,
    passwordHash: await bcrypt.hash(spec.password, salt),
    fullName: spec.fullName,
    matricNo: spec.matricNo,
    role: spec.role,
    isVerified: true,
  });
  return created.id as string;
}

async function upsertElection(spec: ElectionSpec, createdById: string): Promise<string> {
  const existing = await db.orm.public.Election.where({ title: spec.title }).first();
  if (existing) return existing.id as string;

  const created = await db.orm.public.Election.create({
    title: spec.title,
    description: spec.description,
    status: spec.status,
    startsAt: hoursFromNow(spec.openHours) as never,
    endsAt: hoursFromNow(spec.closeHours) as never,
    publishedAt: spec.status === "PUBLISHED" ? (hoursFromNow(spec.closeHours + 1) as never) : null,
    createdById,
  });
  return created.id as string;
}

/** Writes the positions and candidates in the order they are listed. */
async function buildBallot(electionId: string, spec: ElectionSpec): Promise<Map<string, string[]>> {
  const byPosition = new Map<string, string[]>();

  for (const [positionIndex, position] of spec.positions.entries()) {
    const positionId = await positionIdOf(electionId, position.title, position.seats, positionIndex);
    byPosition.set(positionId, await candidateIdsOf(positionId, position.candidates));
  }
  return byPosition;
}

/** Creates the position if this election does not already have that title. */
async function positionIdOf(electionId: string, title: string, seats: number, order: number): Promise<string> {
  const existing = await db.orm.public.Position.where({ electionId, title }).first();
  if (existing) return existing.id as string;

  const created = await db.orm.public.Position.create({ electionId, title, seats, order });
  return created.id as string;
}

/** Creates any candidate whose name is missing from the position, keeping list order. */
async function candidateIdsOf(positionId: string, candidates: CandidateSpec[]): Promise<string[]> {
  const ids: string[] = [];

  for (const [order, candidate] of candidates.entries()) {
    const existing = await db.orm.public.Candidate.where({ positionId, fullName: candidate.fullName }).first();
    if (existing) {
      ids.push(existing.id as string);
      continue;
    }
    const created = await db.orm.public.Candidate.create({
      positionId,
      fullName: candidate.fullName,
      manifesto: candidate.manifesto,
      photoUrl: null,
      order,
    });
    ids.push(created.id as string);
  }
  return ids;
}

async function fillRoll(electionId: string, voterIds: string[]): Promise<void> {
  for (const userId of voterIds) {
    const already = await db.orm.public.VoterRoll.where({ electionId, userId }).first();
    if (already) continue;
    await db.orm.public.VoterRoll.create({ electionId, userId });
  }
}

/**
 * Records the ballots and the choices behind them. Votes carry no user, no
 * ballot and no timestamp — that is the whole point of the split — so this
 * writes the two tables in the same shape the vote endpoint does.
 */
async function castBallots(electionId: string, spec: ElectionSpec, voterIds: string[], ballot: Map<string, string[]>): Promise<void> {
  const positionIds = [...ballot.keys()];

  for (const [voterIndex, userId] of voterIds.slice(0, spec.turnout).entries()) {
    const already = await db.orm.public.Ballot.where({ electionId, userId }).first();
    if (already) continue;

    await db.transaction(async (tx) => {
      await tx.orm.public.Ballot.create({
        electionId,
        userId,
        receiptCode: receiptCode(electionId),
        castAt: hoursFromNow((spec.openHours + spec.closeHours) / 2) as never,
      });

      for (const [positionIndex, positionId] of positionIds.entries()) {
        const wanted = spec.pick[positionIndex % spec.pick.length];
        // One voter in four abstains from every position they would otherwise
        // fill, so the tally holds blank votes next to the candidate counts.
        const abstains = wanted === null || voterIndex % 4 === 3;
        const candidateIds = ballot.get(positionId) ?? [];

        if (abstains) {
          await tx.orm.public.Vote.create({ electionId, positionId, candidateId: null });
          continue;
        }
        // A seat count above one gets one vote per chosen candidate, walking the
        // list so no single candidate collects every ballot.
        const seats = Math.max(1, candidateIds.length > 1 && positionIndex % 2 === 1 ? 2 : 1);
        for (let seat = 0; seat < Math.min(seats, candidateIds.length); seat++) {
          const candidateId = candidateIds[(wanted + seat + voterIndex) % candidateIds.length];
          await tx.orm.public.Vote.create({ electionId, positionId, candidateId });
        }
      }
    });
  }
}

async function main(): Promise<void> {
  console.log(FRESH ? "Fresh seed: every existing row will be deleted."
    : RESET ? "Fixture reset: only the elections named in this script are rebuilt."
    : "Additive seed: existing rows are kept.");
  if (FRESH) await emptyAll();
  else if (RESET) await resetFixtureElections();

  const adminId = await upsertUser(USERS[0]);
  const voterIds: string[] = [];
  for (const spec of USERS.slice(1)) voterIds.push(await upsertUser(spec));

  for (const spec of ELECTIONS) {
    const electionId = await upsertElection(spec, adminId);
    const ballot = await buildBallot(electionId, spec);
    await fillRoll(electionId, voterIds);
    if (spec.turnout > 0) await castBallots(electionId, spec, voterIds, ballot);

    const votes = await db.orm.public.Vote.where({ electionId }).aggregate((a) => ({ votes: a.count() }));
    const ballots = await db.orm.public.Ballot.where({ electionId }).aggregate((a) => ({ ballots: a.count() }));
    console.log(`${spec.status.padEnd(9)} ${spec.title} — ${ballots.ballots} ballot(s), ${votes.votes} vote row(s)`);
  }

  console.log("\nLogins (the API accepts the email or the matric number):");
  for (const spec of USERS) {
    console.log(`  ${spec.role.padEnd(5)} ${spec.email.padEnd(24)} ${spec.matricNo.padEnd(14)} ${spec.password}`);
  }
  console.log("\nThe client is at http://localhost:5173 and the API at http://localhost:8000/api/v1.");
}

await main();
await db.close();
