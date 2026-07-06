import { create } from "@bufbuild/protobuf";
import { api } from "./api";
import {
  GetDailyChallengeRequestSchema,
  SubmitScoreRequestSchema,
  GetDailyLeaderboardRequestSchema,
  GetStreakRequestSchema,
  type Token,
} from "../gen/memba/v1/memba_pb";

export const gameApi = {
  getDailyChallenge: (date = "") =>
    api.getDailyChallenge(create(GetDailyChallengeRequestSchema, { date })),
  submitScore: (authToken: Token, date: string, moveLog: string) =>
    api.submitScore(create(SubmitScoreRequestSchema, { authToken, date, moveLog })),
  getDailyLeaderboard: (date: string, limit = 50) =>
    api.getDailyLeaderboard(create(GetDailyLeaderboardRequestSchema, { date, limit })),
  getStreak: (address: string) =>
    api.getStreak(create(GetStreakRequestSchema, { address })),
};
