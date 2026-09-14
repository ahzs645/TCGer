import { DurableObject } from 'cloudflare:workers';

// Only reachable through a Worker binding. One object per user and one global
// object serialize admissions across locations. Rejected requests do not write.
export class PricingQuota extends DurableObject {
  async consume({ cards, cardLimit, requestLimit }) {
    if (![cards, cardLimit, requestLimit].every(Number.isSafeInteger) || cards < 1 || cards > 50 ||
        cardLimit < 1 || requestLimit < 1) throw new Error('Invalid quota request');
    const now = Date.now();
    const day = Math.floor(now / 86_400_000);
    const retryAfter = Math.ceil(((day + 1) * 86_400_000 - now) / 1000);
    return this.ctx.storage.transaction(async storage => {
      const prior = await storage.get('usage');
      const usage = prior?.day === day ? prior : { day, cards: 0, requests: 0 };
      if (usage.cards + cards > cardLimit || usage.requests + 1 > requestLimit) {
        return { allowed: false, retryAfter };
      }
      await storage.put('usage', { day, cards: usage.cards + cards, requests: usage.requests + 1 });
      // Purge inactive identities; the counter also resets on the first new-day request.
      await storage.setAlarm((day + 2) * 86_400_000);
      return { allowed: true, retryAfter: 0 };
    });
  }

  async alarm() {
    // A delayed alarm must not erase usage written by a more recent request.
    await this.ctx.storage.transaction(async storage => {
      const usage = await storage.get('usage');
      if (!usage) return;
      const expires = (usage.day + 2) * 86_400_000;
      if (expires <= Date.now()) await storage.delete('usage');
      else await storage.setAlarm(expires);
    });
  }
}
