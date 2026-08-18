import { DemoSharedBinder } from "./demo-shared-binder";

const STATIC_EXPORT_SHARE_TOKEN = "__static-export-placeholder__";

export function generateStaticParams() {
  return process.env.DEMO_EXPORT === "true"
    ? [{ shareToken: STATIC_EXPORT_SHARE_TOKEN }]
    : [];
}

export default async function DemoSharedBinderPage({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;
  return <DemoSharedBinder shareToken={shareToken} />;
}
