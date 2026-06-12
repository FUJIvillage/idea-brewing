import { notFound } from "next/navigation";
import { readBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { BrewWorkbench } from "@/components/brew-workbench";

export const dynamic = "force-dynamic";

export default async function BrewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let brew: Brew;
  try {
    brew = await readBrew(id);
  } catch {
    notFound();
  }
  return <BrewWorkbench initial={brew} />;
}
