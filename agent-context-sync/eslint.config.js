// Flat config for ESLint 9 (minimal, dependency-shape-safe).
const tsparser = require("@typescript-eslint/parser");
const tsplugin = require("@typescript-eslint/eslint-plugin");

module.exports = [
  {
    files: ["src/**/*.ts"],
    ignores: ["src/vendor/**"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: "commonjs" }
    },
    plugins: { "@typescript-eslint": tsplugin },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "off"
    }
  }
];
