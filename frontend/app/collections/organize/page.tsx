"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Archive,
  BadgeDollarSign,
  Keyboard,
  ShieldCheck,
} from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import {
  AcquisitionCostSplitter,
  PsaCertificateIntake,
  RapidSetEntry,
} from "@/components/collections/intake-tools";
import { StorageEditor } from "@/components/collections/storage-editor";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsStore } from "@/stores/collections";

export default function CollectionOrganizationPage() {
  const token = useAuthStore((state) => state.token);
  const hasFetched = useCollectionsStore((state) => state.hasFetched);
  const isLoading = useCollectionsStore((state) => state.isLoading);
  const fetchCollections = useCollectionsStore(
    (state) => state.fetchCollections,
  );
  useEffect(() => {
    if (token && !hasFetched && !isLoading) void fetchCollections(token);
  }, [fetchCollections, hasFetched, isLoading, token]);

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Collection operations"
          description="File physical cards, enter a set quickly, allocate acquisition costs, and intake graded cards."
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href="/collections">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Inventory
              </Link>
            </Button>
          }
        />
        <Tabs defaultValue="storage">
          <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="storage">
              <Archive className="mr-2 h-4 w-4" />
              Storage
            </TabsTrigger>
            <TabsTrigger value="rapid">
              <Keyboard className="mr-2 h-4 w-4" />
              Rapid entry
            </TabsTrigger>
            <TabsTrigger value="cost">
              <BadgeDollarSign className="mr-2 h-4 w-4" />
              Cost split
            </TabsTrigger>
            <TabsTrigger value="psa">
              <ShieldCheck className="mr-2 h-4 w-4" />
              PSA intake
            </TabsTrigger>
          </TabsList>
          <TabsContent value="storage">
            <StorageEditor />
          </TabsContent>
          <TabsContent value="rapid">
            <RapidSetEntry />
          </TabsContent>
          <TabsContent value="cost">
            <AcquisitionCostSplitter />
          </TabsContent>
          <TabsContent value="psa">
            <PsaCertificateIntake />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
