/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "zero-runtime-deps": {
      description:
        "package.json must have no dependencies field — the library ships zero runtime dependencies",
      async check(ctx) {
        const pkg = (await ctx.readJSON("package.json")) as {
          dependencies?: Record<string, string>;
        };

        if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
          const depNames = Object.keys(pkg.dependencies).join(", ");
          ctx.report.violation({
            message: `package.json has runtime dependencies: ${depNames}. This library must ship with zero runtime dependencies`,
            file: "package.json",
            fix: "Move these packages to devDependencies or peerDependencies, or remove them entirely",
          });
        }
      },
    },

    "peer-deps-optional": {
      description:
        "Every peerDependency must have a corresponding peerDependenciesMeta entry with optional: true",
      async check(ctx) {
        const pkg = (await ctx.readJSON("package.json")) as {
          peerDependencies?: Record<string, string>;
          peerDependenciesMeta?: Record<string, { optional?: boolean }>;
        };

        const peers = pkg.peerDependencies;
        if (!peers || Object.keys(peers).length === 0) {
          return;
        }

        const meta = pkg.peerDependenciesMeta ?? {};

        for (const peerName of Object.keys(peers)) {
          if (!meta[peerName]) {
            ctx.report.violation({
              message: `Peer dependency "${peerName}" has no entry in peerDependenciesMeta`,
              file: "package.json",
              fix: `Add "${peerName}": { "optional": true } to peerDependenciesMeta`,
            });
          } else if (meta[peerName].optional !== true) {
            ctx.report.violation({
              message: `Peer dependency "${peerName}" is not marked as optional in peerDependenciesMeta`,
              file: "package.json",
              fix: `Set "optional": true for "${peerName}" in peerDependenciesMeta`,
            });
          }
        }
      },
    },

    "no-foreign-lockfiles": {
      description:
        "Only bun.lock should exist — no package-lock.json, yarn.lock, or pnpm-lock.yaml",
      severity: "warning",
      async check(ctx) {
        const foreignLockfiles = [
          { file: "package-lock.json", manager: "npm" },
          { file: "yarn.lock", manager: "Yarn" },
          { file: "pnpm-lock.yaml", manager: "pnpm" },
        ];

        for (const { file, manager } of foreignLockfiles) {
          const matches = await ctx.glob(file);
          if (matches.length > 0) {
            ctx.report.warning({
              message: `Found ${file} — this project uses Bun exclusively. ${manager} lockfiles should not be committed`,
              file,
              fix: `Remove ${file} and add it to .gitignore`,
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
