import migration1 from "../migrations/0001_spine.sql?raw";
import migration2 from "../migrations/0002_config.sql?raw";

export async function applyMigrations(db: D1Database): Promise<void> {
  const statements = migration1.split(";").map(s => s.trim()).filter(Boolean);

  for (let i = 0; i < statements.length; i++) {
    // Normalize whitespace and add semicolon back
    const normalized = statements[i].replace(/\s+/g, " ").trim() + ";";
    await db.exec(normalized);
  }

  for (const stmt of migration2.split(";").map(s => s.trim()).filter(Boolean)) {
    await db.exec(stmt);
  }
}
