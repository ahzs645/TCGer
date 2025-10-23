import { CardDTO, TcgAdapter, TcgCode } from './types';

class StaticAdapter implements TcgAdapter {
  readonly game: TcgCode;

  constructor(game: TcgCode) {
    this.game = game;
  }

  async searchCards(query: string): Promise<CardDTO[]> {
    // Placeholder implementation until real adapters are introduced.
    return [
      {
        id: `${this.game}-stub-${Buffer.from(query).toString('hex').slice(0, 8)}`,
        tcg: this.game,
        name: `Sample ${this.game} card for "${query}"`,
        attributes: { source: 'stub' }
      }
    ];
  }

  async fetchCardById(_externalId: string): Promise<CardDTO | null> {
    return null;
  }
}

class AdapterRegistry {
  private readonly adapters = new Map<TcgCode, TcgAdapter>();

  constructor(initialAdapters: TcgAdapter[]) {
    initialAdapters.forEach((adapter) => this.adapters.set(adapter.game, adapter));
  }

  get(tcg: string): TcgAdapter {
    const adapter = this.adapters.get(tcg as TcgCode);
    if (!adapter) {
      const error = new Error(`Adapter for ${tcg} not found`);
      (error as Error & { status?: number }).status = 503;
      throw error;
    }
    return adapter;
  }

  list(): TcgAdapter[] {
    return Array.from(this.adapters.values());
  }
}

const defaultAdapters = (['yugioh', 'magic', 'pokemon'] as const).map(
  (game) => new StaticAdapter(game)
);

export const adapterRegistry = new AdapterRegistry(defaultAdapters);
