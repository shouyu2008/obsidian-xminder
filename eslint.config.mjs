// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";

export default defineConfig([
  {
    ignores: ["dist/**", "node_modules/**", "*.js", "*.mjs"],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  ...obsidianmd.configs.recommended,
  // Or include English locale files (JSON and TS/JS modules)
  // ...obsidianmd.configs.recommendedWithLocalesEn,

  {
    files: ["**/*.ts"],
    plugins: {
      "@eslint-community/eslint-comments": eslintComments,
    },
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
      globals: {
        document: "readonly",
        window: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        navigator: "readonly",
        console: "readonly",
      },
    },

    // Optional project overrides
    rules: {
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          brands: ["YourBrand"],
          acronyms: ["OK"],
          enforceCamelCaseLower: true,
        },
      ],
      "require-await": "error",
      "@eslint-community/eslint-comments/require-description": "error",
      "@eslint-community/eslint-comments/no-restricted-disable": [
        "error",
        "obsidianmd/no-static-styles-assignment",
        "@typescript-eslint/no-explicit-any",
        "@microsoft/sdl/no-inner-html",
      ],
      "import/no-extraneous-dependencies": "off",
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        __dirname: "readonly",
        module: "readonly",
        require: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
    },
  },
]);
