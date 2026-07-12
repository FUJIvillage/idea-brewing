import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { collectLeaderboard } from "@/lib/pub/leaderboard";

export async function GET() {
  try {
    return NextResponse.json({ entries: await collectLeaderboard() });
  } catch (err) {
    return errorResponse(err);
  }
}
