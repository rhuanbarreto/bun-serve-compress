/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "no-barrel-self-import": {
      description:
        "Source files in src/ must not import from ./index — the barrel file is for external consumers only",
      async check(ctx) {
        const srcFiles = await ctx.glob("src/**/*.ts");

        for (const file of srcFiles) {
          // Skip index.ts itself
          if (file.endsWith("index.ts")) continue;

          const matches = await ctx.grep(file, /from\s+["']\.\/index["']/);

          for (const match of matches) {
            ctx.report.violation({
              message:
                "Importing from ./index within src/ creates circular dependencies. Import directly from the specific module instead",
              file: match.file,
              line: match.line,
              fix: 'Replace "./index" with the specific module path (e.g., "./compress", "./types")',
            });
          }
        }
      },
    },

    "no-path-aliases": {
      description:
        "Source files in src/ must use relative imports only — no path aliases (@/, ~/, #/)",
      async check(ctx) {
        const matches = await ctx.grepFiles(/from\s+["'](@\/|~\/|#\/)/, "src/**/*.ts");

        for (const match of matches) {
          ctx.report.violation({
            message: `Path alias import found: "${match.content.trim()}". Use relative imports (e.g., "./compress") instead`,
            file: match.file,
            line: match.line,
            fix: "Replace the path alias with a relative import path",
          });
        }
      },
    },
  },
} satisfies RuleSet;
