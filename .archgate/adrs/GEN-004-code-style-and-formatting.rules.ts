/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "no-foreign-style-tools": {
      description:
        "No ESLint, Prettier, Biome, or dprint configuration files may exist in the project",
      severity: "warning",
      async check(ctx) {
        const foreignConfigs = [
          { pattern: ".eslintrc*", tool: "ESLint" },
          { pattern: ".eslintrc.json", tool: "ESLint" },
          { pattern: ".eslintrc.js", tool: "ESLint" },
          { pattern: ".eslintrc.cjs", tool: "ESLint" },
          { pattern: ".eslintrc.yml", tool: "ESLint" },
          { pattern: "eslint.config.*", tool: "ESLint (flat config)" },
          { pattern: ".prettierrc*", tool: "Prettier" },
          { pattern: ".prettierrc.json", tool: "Prettier" },
          { pattern: ".prettierrc.js", tool: "Prettier" },
          { pattern: "prettier.config.*", tool: "Prettier" },
          { pattern: "biome.json", tool: "Biome" },
          { pattern: "biome.jsonc", tool: "Biome" },
          { pattern: "dprint.json", tool: "dprint" },
          { pattern: ".dprint.json", tool: "dprint" },
        ];

        for (const { pattern, tool } of foreignConfigs) {
          const matches = await ctx.glob(pattern);
          for (const file of matches) {
            ctx.report.warning({
              message: `Found ${tool} configuration file. This project uses oxlint and oxfmt exclusively`,
              file,
              fix: `Remove ${file} — use .oxlintrc.json for linting and .oxfmtrc.json for formatting`,
            });
          }
        }
      },
    },

    "constants-naming": {
      description: "Exported const declarations in src/constants.ts must use SCREAMING_SNAKE_CASE",
      async check(ctx) {
        const constantsFiles = await ctx.glob("src/constants.ts");
        if (constantsFiles.length === 0) return;

        const matches = await ctx.grepFiles(
          /export\s+const\s+([a-zA-Z_][a-zA-Z0-9_]*)/,
          "src/constants.ts",
        );

        const screamingSnakeCase = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

        for (const match of matches) {
          const nameMatch = match.content.match(/export\s+const\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
          if (!nameMatch) continue;

          const name = nameMatch[1];

          // Skip function declarations (export function) that might be caught
          if (match.content.includes("export function")) continue;

          // Only check non-function const exports
          if (!screamingSnakeCase.test(name)) {
            ctx.report.violation({
              message: `Exported constant "${name}" in constants.ts must use SCREAMING_SNAKE_CASE`,
              file: match.file,
              line: match.line,
              fix: `Rename to ${name
                .replace(/([a-z])([A-Z])/g, "$1_$2")
                .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
                .toUpperCase()}`,
            });
          }
        }
      },
    },

    "public-api-jsdoc": {
      description: "Exported functions in src/ files should have JSDoc comments",
      severity: "info",
      async check(ctx) {
        const srcFiles = await ctx.glob("src/**/*.ts");

        for (const file of srcFiles) {
          const exportedFunctions = await ctx.grep(file, /^export\s+function\s+(\w+)/);

          for (const match of exportedFunctions) {
            // Check if the line before the export has a JSDoc closing tag
            const lineAbove = match.line - 1;
            if (lineAbove < 1) {
              ctx.report.info({
                message: `Exported function "${match.content.match(/function\s+(\w+)/)?.[1]}" has no JSDoc comment`,
                file: match.file,
                line: match.line,
                fix: "Add a JSDoc comment above the function with at minimum a one-line summary",
              });
              continue;
            }

            const jsdocCheck = await ctx.grep(file, /\*\//);
            const hasJsdocEndingNearby = jsdocCheck.some(
              (m) => m.line >= lineAbove - 1 && m.line <= match.line - 1,
            );

            if (!hasJsdocEndingNearby) {
              const funcName = match.content.match(/function\s+(\w+)/)?.[1];
              ctx.report.info({
                message: `Exported function "${funcName}" appears to have no JSDoc comment`,
                file: match.file,
                line: match.line,
                fix: "Add a JSDoc comment above the function with at minimum a one-line summary",
              });
            }
          }
        }
      },
    },
  },
} satisfies RuleSet;
