import { NextResponse } from "next/server";
import { brewNotFound, findBrew } from "@/lib/api";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const brew = await findBrew(id);
  return brew ? NextResponse.json(brew) : brewNotFound();
}
