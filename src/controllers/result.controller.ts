import type { Request, Response } from "express";
import { db } from "../prisma/db.ts";
import { uuidParam } from "../lib/validation.ts";
import { asyncHandler, forbidden, notFound } from "../lib/http.ts";

/** Deterministic tie-break so two runs of the same data answer the same way. */
const byStableCandidateOrder = (a: { order: number; id: string }, b: { order: number; id: string }) =>
  a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const getElectionResults = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const electionId = uuidParam(req.params.electionId, "Election");
  const user = req.user;
  const isAdmin = user?.role === "ADMIN";

  const election = await db.orm.public.Election.where({ id: electionId }).first();
  if (!election) {
    throw notFound("Election not found");
  }

  /**
   * Access control (Fix C6):
   * - While election is DRAFT or OPEN, NO ONE (not even admins) may view tallies to prevent election interference.
   * - When election is CLOSED, only ADMINs can view preliminary results for verification prior to publishing.
   * - When election is PUBLISHED, all authenticated users (voters and admins) can view final results.
   */
  if (election.status === "DRAFT" || election.status === "OPEN") {
    throw forbidden("Election tallies cannot be viewed while voting is open or in preparation.", {
      electionStatus: election.status,
    });
  }

  if (election.status === "CLOSED" && !isAdmin) {
    throw forbidden("Election results have not been published yet. Awaiting administrator review.", {
      electionStatus: election.status,
    });
  }

  // Fetch positions & candidates in ballot order
  const positions = await db.orm.public.Position.where({ electionId })
    .orderBy([(p) => p.order.asc(), (p) => p.id.asc()])
    .include("candidates")
    .all();

  // Tally in the database: one row per (position, candidate) instead of every vote.
  const tallies = await db.orm.public.Vote.where({ electionId })
    .groupBy("positionId", "candidateId")
    .aggregate((aggregate) => ({ count: aggregate.count() }));

  const countsByPosition = new Map<string, Map<string | null, number>>();
  for (const row of tallies) {
    let perCandidate = countsByPosition.get(row.positionId);
    if (!perCandidate) {
      perCandidate = new Map();
      countsByPosition.set(row.positionId, perCandidate);
    }
    perCandidate.set(row.candidateId ?? null, row.count);
  }

  // Turnout stats
  const { ballots: totalBallots } = await db.orm.public.Ballot.where({ electionId }).aggregate((aggregate) => ({
    ballots: aggregate.count(),
  }));
  const { voters: totalRoll } = await db.orm.public.VoterRoll.where({ electionId }).aggregate((aggregate) => ({
    voters: aggregate.count(),
  }));
  const turnoutPercentage = totalRoll > 0 ? ((totalBallots / totalRoll) * 100).toFixed(2) : "0.00";

  const resultsByPosition = positions.map((pos: any) => {
    const perCandidate = countsByPosition.get(pos.id) ?? new Map<string | null, number>();

    let blankVotes = 0;
    let totalPositionVotes = 0;
    for (const [candidateId, count] of perCandidate) {
      totalPositionVotes += count;
      if (candidateId === null) blankVotes = count;
    }

    const candidates = [...pos.candidates].sort(byStableCandidateOrder);

    const ranked = candidates
      .map((c: any) => ({ candidate: c, voteCount: perCandidate.get(c.id) ?? 0 }))
      // Vote count first, then the ballot's own candidate order, then id: a
      // re-run over the same rows cannot reshuffle the answer.
      .sort(
        (a: any, b: any) =>
          b.voteCount - a.voteCount || byStableCandidateOrder(a.candidate, b.candidate),
      );

    const candidateResults = ranked.map(({ candidate, voteCount }: any) => {
      const percentage = totalPositionVotes > 0 ? ((voteCount / totalPositionVotes) * 100).toFixed(2) : "0.00";
      return {
        id: candidate.id,
        fullName: candidate.fullName,
        photoUrl: candidate.photoUrl,
        voteCount,
        percentage: `${percentage}%`,
      };
    });

    // Determine winners based on available seats (Fix M5: candidates with 0 votes cannot be declared winners)
    const eligibleWinners = candidateResults.filter((c: any) => c.voteCount > 0);
    const winners = eligibleWinners.slice(0, pos.seats);

    // Check for ties at the seat boundary
    let hasTie = false;
    if (winners.length > 0 && eligibleWinners.length > pos.seats) {
      const lastWinnerVotes = winners[winners.length - 1].voteCount;
      const firstRunnerUpVotes = eligibleWinners[pos.seats].voteCount;
      if (lastWinnerVotes === firstRunnerUpVotes) {
        hasTie = true;
      }
    }

    return {
      positionId: pos.id,
      title: pos.title,
      seats: pos.seats,
      totalVotes: totalPositionVotes,
      blankVotes,
      candidates: candidateResults,
      winners,
      hasTie,
    };
  });

  res.status(200).json({
    election: {
      id: election.id,
      title: election.title,
      status: election.status,
      publishedAt: election.publishedAt,
    },
    turnout: {
      registeredVoters: totalRoll,
      ballotsCast: totalBallots,
      turnoutPercentage: `${turnoutPercentage}%`,
    },
    results: resultsByPosition,
  });
});
