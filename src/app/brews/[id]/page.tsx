import { notFound } from "next/navigation";
import { readBrew } from "@/lib/store";
import { BrewWorkbench } from "@/components/brew-workbench";

export const dynamic = "force-dynamic";

export default async function BrewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  try {
    const brew = await readBrew(id);
    return <BrewWorkbench initial={brew} />;
  } catch {
    notFound();
  }
}
