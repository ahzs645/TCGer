import type { Metadata } from "next";
import { TransactionsContent } from "@/components/transactions/transactions-content";

export const metadata: Metadata = {
  title: "Transactions",
};

export default function TransactionsPage() {
  return <TransactionsContent />;
}
