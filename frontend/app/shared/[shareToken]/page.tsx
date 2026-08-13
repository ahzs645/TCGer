import Image from "next/image";
import { notFound } from "next/navigation";
import { Layers3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPublicCollection } from "@/lib/api/public-collections";

export function generateStaticParams() {
  return [];
}

export default async function SharedCollectionPage({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;
  const collection = await getPublicCollection(shareToken).catch(() => null);
  if (!collection) notFound();

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="space-y-3">
          <Badge variant="secondary">Shared binder</Badge>
          <h1 className="font-heading text-4xl font-semibold">{collection.name}</h1>
          {collection.description && (
            <p className="max-w-2xl text-muted-foreground">{collection.description}</p>
          )}
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Layers3 className="h-4 w-4" />
            {collection.cardCount} cards · shared by {collection.owner}
          </p>
        </header>

        {collection.cards.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">This binder is empty.</CardContent></Card>
        ) : (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {collection.cards.map((card, index) => (
              <Card key={`${card.name}-${card.setName ?? ""}-${index}`} className="overflow-hidden">
                <div className="relative aspect-[5/3] bg-muted">
                  {card.imageUrl ? (
                    <Image src={card.imageUrl} alt={card.name} fill sizes="(max-width: 640px) 100vw, 25vw" className="object-contain p-3" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground"><Layers3 className="h-10 w-10" /></div>
                  )}
                </div>
                <CardHeader className="space-y-2">
                  <CardTitle className="text-base">{card.name}</CardTitle>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{card.tcg}</Badge>
                    {card.setName && <span>{card.setName}</span>}
                    {card.condition && <span>{card.condition}</span>}
                    <span>×{card.quantity}</span>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
