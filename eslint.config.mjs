import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// Base configurations extended using FlatCompat
const baseConfigs = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

// Custom rule overrides
const customRules = {
  files: ["**/*.{js,jsx,ts,tsx}"], // Apply these rules to all JS/TS files
  rules: {
    // Disable or adjust specific rules:
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "warn", // Warn instead of error
    "react-hooks/exhaustive-deps": "warn",    // Warn instead of error
    "prefer-const": "off",
    "@typescript-eslint/no-empty-object-type": "off",
  },
};

// Relaxed rules for imported DAW feature code (from excellent-daw)
const dawOverrides = {
  files: ["src/features/daw/**/*.{ts,tsx}"],
  rules: {
    "react-hooks/rules-of-hooks": "warn",
    "@typescript-eslint/no-require-imports": "off",
  },
};

// The pause invariant, enforced: instrument visuals must be pure functions of
// state.beat (+ params/notes) - see src/editor/core/visual/instrumentFrame.ts.
// Banning every other time/randomness source makes the invariant unwritable
// rather than merely discouraged. Frame access goes through useInstrumentFrame
// (which deliberately exposes no clock/delta); randomness through seededRand.
const instrumentInvariant = {
  files: ["src/editor/instruments/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@react-three/fiber",
            importNames: ["useFrame"],
            message:
              "Instruments use useInstrumentFrame(trackId, cb) from core/visual/instrumentFrame - it exposes state.beat/state.secPerBeat and nothing wall-clock.",
          },
        ],
      },
    ],
    "no-restricted-properties": [
      "error",
      {
        object: "performance",
        property: "now",
        message: "Wall-clock time breaks the pause invariant. Derive time from state.beat (* state.secPerBeat for seconds).",
      },
      {
        object: "Date",
        property: "now",
        message: "Wall-clock time breaks the pause invariant. Derive time from state.beat (* state.secPerBeat for seconds).",
      },
      {
        object: "Math",
        property: "random",
        message: "Non-deterministic randomness breaks scrub reproducibility. Use seededRand(seed) from core/visual/instrumentFrame.",
      },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: "Identifier[name='elapsedTime']",
        message: "The r3f clock is wall-time and breaks the pause invariant. Derive time from state.beat.",
      },
      {
        selector: "Identifier[name='getElapsedTime']",
        message: "The r3f clock is wall-time and breaks the pause invariant. Derive time from state.beat.",
      },
      {
        selector: "NewExpression[callee.name='Date'][arguments.length=0]",
        message: "Wall-clock time breaks the pause invariant. Derive time from state.beat.",
      },
    ],
  },
};

// Combine base configs and custom rules
const eslintConfig = [...baseConfigs, customRules, dawOverrides, instrumentInvariant];

export default eslintConfig;
