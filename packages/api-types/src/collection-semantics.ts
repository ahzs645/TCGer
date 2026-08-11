/**
 * Shared collection-mutation semantics, as data.
 *
 * The rules for adding, editing, moving and removing collection copies are
 * implemented twice — once in `frontend/src/stores/demo-store.ts` (+
 * `demo-adapter.ts`) for demo mode, and once in
 * `convex-backend/convex/bridge.ts` (+ the `toLegacyBinder` projection in
 * `convex/http.ts`) for everyone else. They have drifted repeatedly, always in
 * the same way: a field is added to one side's list and not the other's, and
 * nothing fails.
 *
 * `docs/stage4-shared-collection-semantics.md` costs out extracting the rules
 * into one module and recommends against it — the two sides do not share a data
 * shape, and the server copy is 230 lines of Convex-coupled mutation logic with
 * an audit trail threaded through it. What both sides *do* share is the REST
 * contract, so the rules are pinned here as request/response fixtures instead:
 * data only, no logic, driven by a harness on each side.
 *
 *   - demo:   `frontend/src/lib/api/__tests__/collection-semantics.test.ts`
 *   - server: `convex-backend/convex/collectionSemantics.test.ts`
 *
 * A case added here fails on whichever side has not implemented it. That is the
 * point: it converts silent divergence into a red test.
 *
 * This module is imported only by tests. Nothing here is bundled into the
 * Convex deployment or the browser.
 */

/** Placeholder for the second binder's id, substituted by each harness. */
export const SECONDARY_BINDER_TOKEN = "__secondary_binder__";

export type SemanticsBinder = "primary" | "secondary";

export interface SemanticsCardData {
  tcg: string;
  externalId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
}

export interface SemanticsSeed {
  /** Copies to create, via `POST /collections/:binderId/cards`. */
  quantity: number;
  cardData: SemanticsCardData;
  /** Extra copy-level fields sent alongside the card. */
  fields?: Record<string, unknown>;
}

export type SemanticsAction =
  | {
      kind: "patch";
      /**
       * `card` addresses the grouped card's id; `copy0` addresses the first
       * copy's id. On the server these are the same string — see the
       * `move-*` cases.
       */
      target: "card" | "copy0";
      body: Record<string, unknown>;
    }
  | { kind: "delete"; target: "card" | "copy0" };

export interface SemanticsExpectation {
  binder: SemanticsBinder;
  externalId: string;
  /** `null` means the card must not be present in that binder at all. */
  quantity: number | null;
  /** Field assertions against the first copy of the grouped card. */
  copy0?: Record<string, unknown>;
}

export interface CollectionSemanticsCase {
  id: string;
  description: string;
  /** Create a second binder before running, for the move cases. */
  needsSecondBinder?: boolean;
  seed: SemanticsSeed[];
  action: SemanticsAction;
  expect: SemanticsExpectation[];
}

const COUNTERSPELL: SemanticsCardData = {
  tcg: "magic",
  externalId: "semantics-counterspell",
  name: "Counterspell",
  setCode: "MH2",
  setName: "Modern Horizons 2",
  collectorNumber: "267",
};

const LOTUS: SemanticsCardData = {
  tcg: "magic",
  externalId: "semantics-lotus",
  name: "Black Lotus",
  setCode: "LEA",
  setName: "Limited Edition Alpha",
  collectorNumber: "232",
};

export const COLLECTION_SEMANTICS_CASES: CollectionSemanticsCase[] = [
  {
    id: "patch-without-quantity-keeps-copies",
    description:
      "A PATCH that does not mention quantity must not change how many copies exist. " +
      "The sandbox's buildUpdatePayload() only sends edited fields, so this is the " +
      "normal edit path.",
    seed: [{ quantity: 3, cardData: COUNTERSPELL }],
    action: {
      kind: "patch",
      target: "copy0",
      body: { condition: "Lightly Played" },
    },
    expect: [
      {
        binder: "primary",
        externalId: COUNTERSPELL.externalId,
        quantity: 3,
        copy0: { condition: "Lightly Played" },
      },
    ],
  },
  {
    id: "delete-card-removes-every-copy",
    description:
      "DELETE with the card-level id removes the whole card. Every client means " +
      "this: the web stepper only deletes at quantity 0 and reports 'Card removed " +
      "from binder.', and the iOS delete/bulk-delete/mark-as-sold paths all drop " +
      "the card from local state afterwards.",
    seed: [{ quantity: 3, cardData: COUNTERSPELL }],
    action: { kind: "delete", target: "card" },
    expect: [
      {
        binder: "primary",
        externalId: COUNTERSPELL.externalId,
        quantity: null,
      },
    ],
  },
  {
    id: "add-keeps-grading-and-storage",
    description:
      "Grading and storage details supplied on add must survive. The demo dropped " +
      "all four while its own copy factory already supported them.",
    seed: [
      {
        quantity: 1,
        cardData: LOTUS,
        fields: {
          gradingCompany: "PSA",
          gradingScore: "10",
          certNumber: "12345678",
          storageLocation: "Vault A",
        },
      },
    ],
    action: { kind: "patch", target: "copy0", body: { notes: "graded" } },
    expect: [
      {
        binder: "primary",
        externalId: LOTUS.externalId,
        quantity: 1,
        copy0: {
          gradingCompany: "PSA",
          gradingScore: "10",
          certNumber: "12345678",
          storageLocation: "Vault A",
          notes: "graded",
        },
      },
    ],
  },
  {
    id: "patch-sets-serial-and-acquired-at",
    description:
      "serialNumber and acquiredAt are in updateCardSchema and handled by the " +
      "bridge; the demo's update map had no branch for either.",
    seed: [{ quantity: 1, cardData: LOTUS }],
    action: {
      kind: "patch",
      target: "copy0",
      body: {
        serialNumber: "007/100",
        acquiredAt: "2026-01-15T00:00:00.000Z",
      },
    },
    expect: [
      {
        binder: "primary",
        externalId: LOTUS.externalId,
        quantity: 1,
        copy0: {
          serialNumber: "007/100",
          acquiredAt: "2026-01-15T00:00:00.000Z",
        },
      },
    ],
  },
  {
    id: "clearing-finish-clears-foil",
    description:
      "Clearing finishCode clears isFoil with it. The sandbox editor sends both " +
      "together so this is invisible there, but the print-selection path sends " +
      "finishCode: null on its own.",
    seed: [
      {
        quantity: 1,
        cardData: LOTUS,
        fields: { isFoil: true, finishCode: "foil", finishLabel: "Foil" },
      },
    ],
    action: { kind: "patch", target: "copy0", body: { finishCode: null } },
    expect: [
      {
        binder: "primary",
        externalId: LOTUS.externalId,
        quantity: 1,
        copy0: { isFoil: false, finishCode: undefined },
      },
    ],
  },
  {
    id: "null-clears-a-nullable-field",
    description:
      "The nullable-clear idiom: undefined keeps the stored value, null clears it. " +
      "Repeated across ~18 fields on both sides; notes stands in for all of them.",
    seed: [
      { quantity: 1, cardData: LOTUS, fields: { notes: "first printing" } },
    ],
    action: { kind: "patch", target: "copy0", body: { notes: null } },
    expect: [
      {
        binder: "primary",
        externalId: LOTUS.externalId,
        quantity: 1,
        copy0: { notes: undefined },
      },
    ],
  },
  {
    id: "move-relocates-one-copy",
    description:
      "targetBinderId moves the addressed copy to another binder. It moves one " +
      "copy rather than the group because the server patches the single addressed " +
      "entry — and because the card-level id is an alias for the first copy's id, " +
      "the collection table's 'move card' and the sandbox's 'move copy' are the " +
      "same request on the wire. Pinned as one copy so both sides agree.",
    needsSecondBinder: true,
    seed: [{ quantity: 3, cardData: COUNTERSPELL }],
    action: {
      kind: "patch",
      target: "copy0",
      body: { targetBinderId: SECONDARY_BINDER_TOKEN },
    },
    expect: [
      { binder: "primary", externalId: COUNTERSPELL.externalId, quantity: 2 },
      { binder: "secondary", externalId: COUNTERSPELL.externalId, quantity: 1 },
    ],
  },
  {
    id: "move-the-only-copy-empties-the-source",
    description:
      "Moving the last copy leaves no trace of the card in the source binder.",
    needsSecondBinder: true,
    seed: [{ quantity: 1, cardData: LOTUS }],
    action: {
      kind: "patch",
      target: "copy0",
      body: { targetBinderId: SECONDARY_BINDER_TOKEN },
    },
    expect: [
      { binder: "primary", externalId: LOTUS.externalId, quantity: null },
      { binder: "secondary", externalId: LOTUS.externalId, quantity: 1 },
    ],
  },
];
