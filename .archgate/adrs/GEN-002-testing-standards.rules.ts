/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "test-runner-bun-only": {
      description:
        "Test files must import from bun:test exclusively — no Jest, Vitest, or Mocha imports",
      async check(ctx) {
        const testFiles = await ctx.glob("tests/**/*.test.ts");

        if (testFiles.length === 0) {
          return;
        }

        // Check for forbidden test runner imports
        const forbiddenPatterns = [
          { pattern: /from\s+["']@jest\/globals["']/, name: "Jest (@jest/globals)" },
          { pattern: /from\s+["']vitest["']/, name: "Vitest" },
          { pattern: /from\s+["']mocha["']/, name: "Mocha" },
          { pattern: /require\s*\(\s*["']jest["']\s*\)/, name: "Jest (require)" },
          { pattern: /require\s*\(\s*["']mocha["']\s*\)/, name: "Mocha (require)" },
        ];

        for (const { pattern, name } of forbiddenPatterns) {
          const matches = await ctx.grepFiles(pattern, "tests/**/*.test.ts");
          for (const match of matches) {
            ctx.report.violation({
              message: `Test file imports from ${name}. All tests must use bun:test exclusively`,
              file: match.file,
              line: match.line,
              fix: 'Replace with: import { describe, test, expect } from "bun:test"',
            });
          }
        }

        // Verify test files import from bun:test
        for (const file of testFiles) {
          const bunTestImports = await ctx.grep(file, /from\s+["']bun:test["']/);
          if (bunTestImports.length === 0) {
            ctx.report.violation({
              message: "Test file does not import from bun:test",
              file,
              fix: 'Add: import { describe, test, expect } from "bun:test"',
            });
          }
        }
      },
    },

    "test-file-location": {
      description: "Test files (*.test.ts) must reside in the tests/ directory, not in src/",
      async check(ctx) {
        // Check for test files incorrectly placed in src/
        const srcTestFiles = await ctx.glob("src/**/*.test.ts");
        for (const file of srcTestFiles) {
          ctx.report.violation({
            message: "Test file found in src/ directory. All test files must be in tests/",
            file,
            fix: `Move this file to tests/ and update imports accordingly`,
          });
        }

        // Check for .spec.ts files anywhere (wrong naming convention)
        const specFiles = await ctx.glob("tests/**/*.spec.ts");
        for (const file of specFiles) {
          ctx.report.violation({
            message:
              "Test file uses .spec.ts extension. All test files must use .test.ts extension",
            file,
            fix: "Rename from .spec.ts to .test.ts",
          });
        }

        // Check for .test.tsx files (wrong extension for this project)
        const tsxTestFiles = await ctx.glob("tests/**/*.test.tsx");
        for (const file of tsxTestFiles) {
          ctx.report.violation({
            message:
              "Test file uses .test.tsx extension. All test files must use .test.ts extension",
            file,
            fix: "Rename from .test.tsx to .test.ts",
          });
        }
      },
    },
  },
} satisfies RuleSet;
