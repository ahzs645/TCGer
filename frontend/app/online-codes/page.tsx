import type { Metadata } from "next";
import { OnlineCodesContent } from "@/components/online-codes/online-codes-content";

export const metadata: Metadata = {
  title: "Code Vault",
};

export default function OnlineCodesPage() {
  return <OnlineCodesContent />;
}
