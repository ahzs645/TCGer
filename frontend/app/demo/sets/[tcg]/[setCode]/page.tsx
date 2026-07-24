import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { SetDetail } from "@/components/sets/set-detail";
import type { TcgCode } from "@tcg/api-types";

const SUPPORTED_GAMES = new Set<TcgCode>(["yugioh", "magic", "pokemon"]);

interface DemoSetDetailPageProps {
  params: Promise<{
    tcg: string;
    setCode: string;
  }>;
}

export default async function DemoSetDetailPage({
  params,
}: DemoSetDetailPageProps) {
  const { tcg, setCode } = await params;
  if (!SUPPORTED_GAMES.has(tcg as TcgCode)) notFound();

  return (
    <AppShell>
      <SetDetail tcg={tcg as TcgCode} setCode={setCode} />
    </AppShell>
  );
}
