/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "tsconfig-strict": {
      description:
        "tsconfig.json must have strict: true, target ESNext, and moduleResolution bundler",
      async check(ctx) {
        const tsconfig = (await ctx.readJSON("tsconfig.json")) as {
          compilerOptions?: {
            strict?: boolean;
            target?: string;
            moduleResolution?: string;
            module?: string;
          };
        };

        const opts = tsconfig?.compilerOptions;
        if (!opts) {
          ctx.report.violation({
            message: "tsconfig.json is missing compilerOptions",
            file: "tsconfig.json",
          });
          return;
        }

        if (opts.strict !== true) {
          ctx.report.violation({
            message: 'tsconfig.json must set "strict": true',
            file: "tsconfig.json",
            fix: 'Add "strict": true to compilerOptions in tsconfig.json',
          });
        }

        if (opts.target?.toLowerCase() !== "esnext") {
          ctx.report.violation({
            message: `tsconfig.json target must be "ESNext", found "${opts.target}"`,
            file: "tsconfig.json",
            fix: 'Set "target": "ESNext" in compilerOptions',
          });
        }

        if (opts.moduleResolution?.toLowerCase() !== "bundler") {
          ctx.report.violation({
            message: `tsconfig.json moduleResolution must be "bundler", found "${opts.moduleResolution}"`,
            file: "tsconfig.json",
            fix: 'Set "moduleResolution": "bundler" in compilerOptions',
          });
        }

        if (opts.module?.toLowerCase() !== "esnext") {
          ctx.report.violation({
            message: `tsconfig.json module must be "ESNext", found "${opts.module}"`,
            file: "tsconfig.json",
            fix: 'Set "module": "ESNext" in compilerOptions',
          });
        }
      },
    },

    "bun-version-sync": {
      description:
        "engines.bun in package.json must match the MIN_BUN_VERSION_RANGE in source code",
      async check(ctx) {
        const pkg = (await ctx.readJSON("package.json")) as {
          engines?: { bun?: string };
        };

        const enginesBun = pkg?.engines?.bun;
        if (!enginesBun) {
          ctx.report.violation({
            message: "package.json is missing engines.bun field",
            file: "package.json",
            fix: 'Add "engines": { "bun": ">=1.3.3" } to package.json',
          });
          return;
        }

        // Check that the source constants file references the same version range
        const constantsMatches = await ctx.grepFiles(
          /MIN_BUN_VERSION_RANGE\s*=\s*["']([^"']+)["']/,
          "src/constants.ts",
        );

        const serveMatches = await ctx.grepFiles(
          /MIN_BUN_VERSION_RANGE\s*=\s*["']([^"']+)["']/,
          "src/serve.ts",
        );

        const matches = [...constantsMatches, ...serveMatches];

        if (matches.length === 0) {
          ctx.report.warning({
            message:
              "Could not find MIN_BUN_VERSION_RANGE definition in src/constants.ts or src/serve.ts",
          });
          return;
        }

        for (const match of matches) {
          const sourceRange = match.content.match(
            /MIN_BUN_VERSION_RANGE\s*=\s*["']([^"']+)["']/,
          )?.[1];

          if (sourceRange && sourceRange !== enginesBun) {
            ctx.report.violation({
              message: `Version mismatch: package.json engines.bun is "${enginesBun}" but ${match.file} defines MIN_BUN_VERSION_RANGE as "${sourceRange}"`,
              file: match.file,
              line: match.line,
              fix: `Update either package.json engines.bun or ${match.file} so both use "${enginesBun}"`,
            });
          }
        }
      },
    },

    "no-node-imports": {
      description:
        "Source files in src/ must not use node: protocol imports when Bun equivalents exist",
      severity: "warning",
      async check(ctx) {
        const matches = await ctx.grepFiles(
          /from\s+["']node:(fs|path|zlib|crypto|stream|os|url|util|child_process|http|https|net|dns|tls|cluster|worker_threads|perf_hooks|async_hooks)/,
          "src/**/*.ts",
        );

        for (const match of matches) {
          ctx.report.warning({
            message: `Node.js-specific import found: "${match.content.trim()}". Use Bun-native APIs instead`,
            file: match.file,
            line: match.line,
            fix: "Replace with the equivalent Bun API. See https://bun.sh/docs/runtime/nodejs-apis",
          });
        }
      },
    },
  },
} satisfies RuleSet;
