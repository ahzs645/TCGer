"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { validateGameDeck, type DeckResponse } from "@tcg/api-types";
import { addCardToDeck, updateDeckCard, removeDeckCard } from "@/lib/api/decks";
import {
  gamePackageCards,
  listInstalledGamePackages,
} from "@/lib/game-packages/game-package-client";
import { useAuthStore } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PackageDeckBuilder({ deck }: { deck: DeckResponse }) {
  const token = useAuthStore((s) => s.token);
  const client = useQueryClient();
  const format = deck.rules?.formats.find(
    (f) => f.id === (deck.format ?? deck.rules?.defaultFormat),
  );
  const [zone, setZone] = useState(format?.defaultZone ?? "main");
  const [query, setQuery] = useState("");
  const cards = useQuery({
    queryKey: ["package-deck-cards", deck.tcg],
    queryFn: async () => {
      const packages = (await listInstalledGamePackages()).filter(
        (p) => p.manifest.game.id === deck.tcg,
      );
      return (
        await Promise.all(packages.map((p) => gamePackageCards(p.id)))
      ).flat();
    },
  });
  const change = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["decks"] });
      void client.invalidateQueries({ queryKey: ["deck", deck.id] });
    },
  });
  if (!format || !deck.rules)
    return <p role="status">The saved rules do not support this format.</p>;
  const result = validateGameDeck(
    deck.tcg,
    deck.cards,
    deck.rules,
    deck.format,
  );
  return (
    <div className="space-y-4">
      <p role="status" className="text-sm">
        {result.status === "valid"
          ? "Deck meets the installed rules."
          : result.status === "unknown"
            ? "Deck legality needs more data."
            : "Deck needs changes."}
      </p>
      {[...result.errors, ...result.warnings].map((message, i) => (
        <p className="text-xs text-muted-foreground" key={i}>
          {message}
        </p>
      ))}
      {change.error && <p role="alert">{change.error.message}</p>}
      <label className="block text-sm">
        Add cards to{" "}
        <select
          className="ml-2 rounded border bg-background p-2"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
        >
          {format.zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label}
            </option>
          ))}
        </select>
      </label>
      <Input
        aria-label="Search this game's catalog"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search cards"
      />
      {query.trim() &&
        cards.data
          ?.filter((c) =>
            c.name
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
          )
          .slice(0, 30)
          .map((card) => (
            <div
              key={card.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span>{card.name}</span>
              <Button
                size="sm"
                disabled={change.isPending || !token}
                onClick={() =>
                  change.mutate(() =>
                    addCardToDeck(token!, deck.id, {
                      tcg: deck.tcg,
                      externalId: card.id,
                      name: card.name,
                      zone,
                      quantity: 1,
                      cardData: { ...card },
                      imageUrl: card.imageUrl,
                      setCode: card.setCode,
                    }),
                  )
                }
              >
                Add
              </Button>
            </div>
          ))}
      {format.zones.map((z) => (
        <div key={z.id} className="space-y-2">
          <h3 className="text-sm font-semibold">
            {z.label} (
            {deck.cards
              .filter((c) => c.zone === z.id)
              .reduce((n, c) => n + c.quantity, 0)}
            )
          </h3>
          {deck.cards
            .filter((c) => c.zone === z.id)
            .map((card) => (
              <div
                key={card.id}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span className="flex-1">
                  {card.name} ×{card.quantity}
                </span>
                <Input
                  className="w-20"
                  type="number"
                  min={1}
                  max={10000}
                  aria-label={`Quantity of ${card.name}`}
                  defaultValue={card.quantity}
                  key={`${card.id}:${card.quantity}`}
                  disabled={change.isPending || !token}
                  onBlur={(e) => {
                    const quantity = Number(e.target.value);
                    if (
                      Number.isInteger(quantity) &&
                      quantity > 0 &&
                      quantity !== card.quantity
                    )
                      change.mutate(() =>
                        updateDeckCard(token!, deck.id, card.id, { quantity }),
                      );
                  }}
                />
                <select
                  aria-label={`Zone for ${card.name}`}
                  value={card.zone}
                  disabled={change.isPending || !token}
                  onChange={(e) =>
                    change.mutate(() =>
                      updateDeckCard(token!, deck.id, card.id, {
                        zone: e.target.value,
                      }),
                    )
                  }
                >
                  {format.zones.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={change.isPending || !token}
                  onClick={() =>
                    change.mutate(() =>
                      removeDeckCard(token!, deck.id, card.id),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
