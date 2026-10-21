import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  const bindings = env as typeof env & { DB?: D1Database };
  if (!bindings.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Configure the `d1` field in deployment.config.json and provision the production database before using this feature."
    );
  }

  return drizzle(bindings.DB, { schema });
}

