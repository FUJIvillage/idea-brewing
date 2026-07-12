import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { PersonaValidationError, readPersonas, writePersonas } from "@/lib/store";
import type { SavedPersona } from "@/lib/store/types";

export async function GET() {
  return NextResponse.json(await readPersonas());
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as unknown;
    if (!Array.isArray(body)) {
      return NextResponse.json({ error: "常連客は配列で指定してください。" }, { status: 400 });
    }
    return NextResponse.json(await writePersonas(body as SavedPersona[]));
  } catch (err) {
    if (err instanceof PersonaValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return errorResponse(err);
  }
}
