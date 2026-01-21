import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/pg-core/index.ts", "./src/sqlite-core/index.ts"],
  format: "esm",
  dts: { resolve: false },
  clean: true,
  sourcemap: true,
  external: ["drizzle-orm", "@faker-js/faker"],
});
