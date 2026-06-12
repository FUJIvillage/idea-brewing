import { NextResponse } from "next/server";
import { createBrew, listBrews } from "@/lib/store";

export async function GET() {
  return NextResponse.json(await listBrews());
}

export async function POST(req: Request) {
  const { name } = (await req.json()) as { name?: string };
  if (!name?.trim()) {
    return NextResponse.json({ error: "ブリュー名を入力してください。" }, { status: 400 });
  }
  const brew = await createBrew(name.trim());
  return NextResponse.json(brew, { status: 201 });
}
