import { DurableObject } from 'cloudflare:workers';
import { X509Certificate } from 'node:crypto';
import cbor from './attestation-cbor.mjs';
import { verifyAttestation, verifyAssertion } from 'node-app-attest';
import { verifyPlay, digest } from './play-integrity.mjs';

function base64(value, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Invalid attestation encoding');
  return Buffer.from(value, 'base64');
}

export class GuestDevice extends DurableObject {
  async challenge(platform, keyId) {
    const challenge = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    await this.ctx.storage.put('challenge', { platform, keyId, challenge, expires: Date.now() + 300_000 });
    await this.ctx.storage.setAlarm(Date.now() + 300_000);
    return { challenge, expiresIn: 300, enrolled: Boolean(await this.ctx.storage.get('appleKey')) };
  }

  async verify(input) {
    // Serializes counter checks and challenge consumption even during network IO.
    return this.ctx.blockConcurrencyWhile(async () => {
      const pending = await this.ctx.storage.get('challenge');
      if (!pending || pending.expires <= Date.now() || pending.challenge !== input.challenge ||
          pending.platform !== input.platform || pending.keyId !== input.keyId) return null;
      // One attempt per challenge, including failed or malformed attestations.
      await this.ctx.storage.delete('challenge');
      const subject = `device:${input.platform}:${await digest(input.keyId)}`;
      try {
        if (input.platform === 'ios') {
          if (!/^[A-Z0-9]{10}$/.test(this.env.APPLE_TEAM_ID ?? '') || !this.env.APPLE_BUNDLE_ID) return null;
          const options = { bundleIdentifier: this.env.APPLE_BUNDLE_ID, teamIdentifier: this.env.APPLE_TEAM_ID };
          const prior = await this.ctx.storage.get('appleKey');
          if (prior) {
            const result = verifyAssertion({ ...options, assertion: base64(input.assertion, 8192),
              payload: pending.challenge, publicKey: prior.publicKey, signCount: prior.signCount });
            await this.ctx.storage.put('appleKey', { ...prior, signCount: result.signCount });
          } else {
            const attestation = base64(input.attestation, 24000);
            // The library checks Apple's root signatures and nonce. Enforce
            // certificate validity and CA roles in addition to those checks.
            const decoded = cbor.decodeAllSync(attestation);
            if (decoded.length !== 1 || decoded[0].attStmt?.x5c?.length !== 2) return null;
            const certificates = decoded[0].attStmt.x5c.map(value => new X509Certificate(value));
            if (certificates[0].ca || !certificates[1].ca || certificates.some(cert =>
              Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now())) return null;
            const result = verifyAttestation({ ...options, attestation, challenge: pending.challenge,
              keyId: input.keyId, allowDevelopmentEnvironment: false });
            await this.ctx.storage.put('appleKey', { publicKey: result.publicKey, signCount: 0 });
          }
        } else if (input.platform === 'android') {
          if (!await verifyPlay(input, pending.challenge, this.env)) return null;
        } else return null;
        return { subject };
      } catch { return null; }
    });
  }

  async alarm() {
    // Enrollment keys/counters must survive inactivity to prevent assertion
    // replay and preserve identity; only short-lived challenges are removed.
    const pending = await this.ctx.storage.get('challenge');
    if (pending && pending.expires <= Date.now()) await this.ctx.storage.delete('challenge');
    else if (pending) await this.ctx.storage.setAlarm(pending.expires);
  }
}
