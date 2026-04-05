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

// Combine base configs and custom rules
const eslintConfig = [...baseConfigs, customRules, dawOverrides];

export default eslintConfig;
