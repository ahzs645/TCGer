import { DragonBallAdapter } from './dragonball-adapter';
import { LorcanaAdapter } from './lorcana-adapter';
import { MagicAdapter } from './magic-adapter';
import { OnePieceAdapter } from './onepiece-adapter';
import { PokemonAdapter } from './pokemon-adapter';
import { TcgAdapter, TcgCode } from './types';
import { YugiohAdapter } from './yugioh-adapter';

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

const defaultAdapters: TcgAdapter[] = [
  new YugiohAdapter(),
  new MagicAdapter(),
  new PokemonAdapter(),
  new OnePieceAdapter(),
  new LorcanaAdapter(),
  new DragonBallAdapter()
];

export const adapterRegistry = new AdapterRegistry(defaultAdapters);
