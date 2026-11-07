/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Fails the build when chunks import each other in a loop: their code then
 * runs in the wrong order, e.g. the editor's edit guard is set and then
 * reset (see codeSplitting below).
 */
function noChunkLoops(): Plugin {
  return {
    name: "no-chunk-loops",
    generateBundle(_options, bundle) {
      const imports = new Map<string, string[]>();
      for (const item of Object.values(bundle)) if (item.type === "chunk") imports.set(item.fileName, item.imports);
      const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
        if (from === to) return true;
        if (seen.has(from)) return false;
        seen.add(from);
        return (imports.get(from) ?? []).some((next) => reaches(next, to, seen));
      };
      for (const [file, deps] of imports) {
        for (const dep of deps) {
          if (reaches(dep, file)) this.error(`${file} and ${dep} import each other: move what they share into one chunk.`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), noChunkLoops()],
  // The backend (server/) answers /api; in development Vite forwards to it, so
  // the browser sees one origin. NESTBOARD_API_URL points elsewhere if needed.
  // 127.0.0.1, not "localhost": Node tries IPv6 (::1) first, the backend only
  // listens on IPv4, and on Windows each refused attempt costs seconds.
  server: {
    // `ws`: the live connection to an open diagram is a WebSocket. The Host
    // header is passed on as it is, so the backend sees the page's own origin.
    proxy: { "/api": { target: process.env.NESTBOARD_API_URL ?? "http://127.0.0.1:8000", ws: true } },
    // VS Code's forwarded ports (the Ports panel) arrive as *.devtunnels.ms,
    // which Vite turns away unless allowed, e.g. to try several users at once.
    allowedHosts: [".devtunnels.ms"],
    // Compile the app's modules when the server starts, not on the first page
    // load: a cold server is slow to answer everything, /api calls included.
    warmup: { clientFiles: ["./src/main.tsx"] },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    rolldownOptions: {
      output: {
        // The diagram's code comes with a project's pages (src/app/pageLoaders.ts). Left to
        // itself the bundler merges it with code the Organizations page shares, putting it
        // back in the first load. model/rights.ts is not in it: the Organizations page uses it.
        codeSplitting: {
          groups: [
            {
              name: "diagram",
              // Only these modules: what they use stays where the bundler puts it. zundo (undo
              // history) is only used by the diagram store; left out, it lands in a chunk that
              // imports this one, and the two then run in the wrong order.
              includeDependenciesRecursively: false,
              test: /\/src\/(model\/(?!rights)|files\/|api\/(diagrams|live)|store\/(diagramStore|documentStore|viewStore|presenceStore|history))|\/node_modules\/zundo\//,
            },
          ],
        },
      },
    },
  },
  // Pre-bundled at startup, so the dev server never discovers them mid-session
  // and reloads the page (which also breaks running end-to-end tests).
  optimizeDeps: {
    include: ["@xyflow/react", "cmdk", "lucide-react", "radix-ui", "react-markdown", "react-router", "remark-gfm", "zundo", "zustand"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
