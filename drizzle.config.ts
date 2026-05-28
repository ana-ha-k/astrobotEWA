import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
