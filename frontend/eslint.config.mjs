import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier";

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "next-env.d.ts",
      "public/**",
    ],
  },
  ...nextCoreWebVitals,
  prettier,
  {
    // New opinionated rules introduced by react-hooks v6 (via
    // eslint-config-next 16). Surfaced as warnings until the existing code
    // is migrated case by case.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
    },
  },
  {
    // react-three-fiber scenes mutate three.js objects inside useFrame by
    // design; the react-hooks v6 immutability rules misread that as
    // render-phase mutation.
    files: ["src/components/packs/**"],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
