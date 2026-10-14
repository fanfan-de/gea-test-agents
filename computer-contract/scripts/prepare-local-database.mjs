import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { environment, settings } from "./environment.mjs";

if (settings.databaseName !== "gea_worktree_test_20261010")
  throw new Error(
    "This migrator is restricted to the existing isolated test database.",
  );

const require = createRequire(
  path.join(settings.sourceRoot, "packages/db/package.json"),
);
const postgres = require("postgres");
const { drizzle } = require("drizzle-orm/postgres-js");
const { migrate } = require("drizzle-orm/postgres-js/migrator");
const sql = postgres(environment.DATABASE_URL, { max: 1 });
try {
  const [{ name }] = await sql`select current_database() as name`;
  if (name !== settings.databaseName)
    throw new Error(
      "Connected database does not match the isolated test database.",
    );
  const applied =
    await sql`select created_at from drizzle.__drizzle_migrations order by created_at`;
  if (applied.length === 0)
    throw new Error(
      "The existing test migration history is missing; refusing bootstrap.",
    );
  const migrationsFolder = path.join(
    settings.sourceRoot,
    "packages/db/drizzle",
  );
  const journal = JSON.parse(
    await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
  );
  const latest = Number(applied.at(-1).created_at);
  const pending = journal.entries.filter((entry) => entry.when > latest);
  console.log(
    `Verified database: ${name}; pending migrations: ${pending.map((entry) => entry.tag).join(", ") || "none"}`,
  );
  if (pending.length > 0) await migrate(drizzle(sql), { migrationsFolder });
  console.log("Local test database migrations are current.");
} finally {
  await sql.end();
}
