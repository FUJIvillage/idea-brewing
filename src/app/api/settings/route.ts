import { NextResponse } from "next/server";
import { readSettings, writeSettings } from "@/lib/store";
import type { Settings } from "@/lib/store/types";

export async function GET() {
  return NextResponse.json(await readSettings());
}

export async function PUT(req: Request) {
  const body = (await req.json()) as Settings;
  await writeSettings(body);
  return NextResponse.json(body);
}
