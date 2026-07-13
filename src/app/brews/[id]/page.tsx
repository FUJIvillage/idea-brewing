import { notFound } from "next/navigation";
import { readBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { BrewWorkbench } from "@/components/brew-workbench";
import { parseTabParam } from "@/components/ps1/brew-ui";

export const dynamic = "force-dynamic";

export default async function BrewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  let brew: Brew;
  try {
    brew = await readBrew(id);
  } catch {
    notFound();
  }
  return <BrewWorkbench initial={brew} initialTab={parseTabParam(tab)} />;
}
