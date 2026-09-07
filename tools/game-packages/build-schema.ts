/** Generate structural JSON Schemas from the installed Zod 3 contracts.
 * Reference integrity and effective-date comparisons are runtime invariants. */
import { writeFileSync } from "node:fs";
import { z } from "zod";
import {
  gamePackageManifestSchema,
  gamePriceSnapshotSchema,
  gamePackLibrarySchema,
  gamePackageScannerBundleSchema,
} from "../../packages/api-types/src/index";

function schema(type: z.ZodTypeAny): Record<string, unknown> {
  const d = type._def;
  switch (d.typeName) {
    case "ZodEffects":
      return schema(d.schema);
    case "ZodOptional":
    case "ZodNullable":
      return d.typeName === "ZodNullable"
        ? { anyOf: [schema(d.innerType), { type: "null" }] }
        : schema(d.innerType);
    case "ZodDefault":
      return { ...schema(d.innerType), default: d.defaultValue() };
    case "ZodString": {
      const result: Record<string, unknown> = { type: "string" };
      for (const check of d.checks) {
        if (check.kind === "min") result.minLength = check.value;
        if (check.kind === "max") result.maxLength = check.value;
        if (check.kind === "regex") result.pattern = check.regex.source;
        if (check.kind === "datetime") result.format = "date-time";
        if (check.kind === "url") result.format = "uri";
      }
      return result;
    }
    case "ZodNumber": {
      const result: Record<string, unknown> = { type: "number" };
      for (const check of d.checks) {
        if (check.kind === "int") result.type = "integer";
        if (check.kind === "min")
          result[check.inclusive ? "minimum" : "exclusiveMinimum"] =
            check.value;
        if (check.kind === "max")
          result[check.inclusive ? "maximum" : "exclusiveMaximum"] =
            check.value;
      }
      return result;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodLiteral":
      return { const: d.value };
    case "ZodEnum":
      return { type: "string", enum: d.values };
    case "ZodArray":
      return {
        type: "array",
        items: schema(d.type),
        ...(d.minLength ? { minItems: d.minLength.value } : {}),
        ...(d.maxLength ? { maxItems: d.maxLength.value } : {}),
      };
    case "ZodObject": {
      const shape = d.shape() as Record<string, z.ZodTypeAny>;
      return {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(shape).map(([key, value]) => [key, schema(value)]),
        ),
        required: Object.entries(shape)
          .filter(([, value]) => !value.isOptional())
          .map(([key]) => key),
        additionalProperties: d.unknownKeys !== "strict",
      };
    }
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      return { anyOf: [...d.options].map(schema) };
    case "ZodRecord":
      return {
        type: "object",
        propertyNames: schema(d.keyType),
        additionalProperties: schema(d.valueType),
      };
    case "ZodUnknown":
    case "ZodAny":
      return {};
    default:
      throw new Error(`Unsupported schema node ${d.typeName}`);
  }
}
const root = new URL("../../docs/scanner-system/schemas/", import.meta.url);
const manifest = schema(gamePackageManifestSchema);
(manifest.properties as Record<string, unknown>).schema = {
  const: "https://tcger.app/schemas/game-package-manifest/v2",
};
manifest.allOf = [
  ...[
    ["decks", "deckRules"],
    ["pricing", "pricing"],
    ["scanner", "scanner"],
    ["packOpening", "offlinePacks"],
    ["sealedProducts", "sealedProducts"],
  ].map(([flag, capability]) => ({
    if: {
      required: ["definition"],
      properties: {
        definition: {
          required: ["interfaces"],
          properties: {
            interfaces: {
              required: [flag],
              properties: { [flag]: { const: true } },
            },
          },
        },
      },
    },
    then:
      flag === "decks"
        ? { properties: { definition: { required: [capability] } } }
        : { required: [capability] },
  })),
];
for (const [name, value] of [
  ["game-package-manifest.v2", manifest],
  ["game-price-snapshot.v1", schema(gamePriceSnapshotSchema)],
  ["game-pack-library.v1", schema(gamePackLibrarySchema)],
  ["game-scanner-bundle.v1", schema(gamePackageScannerBundleSchema)],
] as const)
  writeFileSync(
    new URL(`${name}.schema.json`, root),
    JSON.stringify(
      {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: name,
        ...value,
      },
      null,
      2,
    ) + "\n",
  );
