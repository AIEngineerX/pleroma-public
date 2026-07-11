import migration from "../migrations/0001_spine.sql?raw";

export async function applyMigrations(db: D1Database): Promise<void> {
  const statements = migration.split(";").map(s => s.trim()).filter(Boolean);

  for (let i = 0; i < statements.length; i++) {
    // Normalize whitespace and add semicolon back
    const normalized = statements[i].replace(/\s+/g, " ").trim() + ";";
    await db.exec(normalized);
  }
}
