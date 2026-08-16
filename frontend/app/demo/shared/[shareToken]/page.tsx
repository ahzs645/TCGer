import { DemoSharedBinder } from "./demo-shared-binder";

export function generateStaticParams() {
  return [];
}

export default async function DemoSharedBinderPage({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;
  return <DemoSharedBinder shareToken={shareToken} />;
}
