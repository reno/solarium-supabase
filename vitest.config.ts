import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Scratch git worktrees under .claude/ are stale copies of this repo, and their
    // "@/..." imports resolve to the alias below — i.e. back into the real tree — so
    // sweeping them in tests the working tree against old test files. Skip them.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
