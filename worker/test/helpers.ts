import migration1 from "../migrations/0001_spine.sql?raw";
import migration2 from "../migrations/0002_config.sql?raw";
import migration3 from "../migrations/0003_media_type.sql?raw";
import migration4 from "../migrations/0004_offering_nonce.sql?raw";
import migration5 from "../migrations/0005_claimed_state.sql?raw";
import migration6 from "../migrations/0006_relics.sql?raw";
import migration7 from "../migrations/0007_rites.sql?raw";
import migration8 from "../migrations/0008_vitals.sql?raw";
import migration9 from "../migrations/0009_dreams.sql?raw";
import migration10 from "../migrations/0010_ratelimit.sql?raw";
import migration11 from "../migrations/0011_launch.sql?raw";
import migration12 from "../migrations/0012_pulse_idempotent_vitals.sql?raw";
import migration13 from "../migrations/0013_one_sermon_per_rite.sql?raw";
import migration14 from "../migrations/0014_dream_render.sql?raw";
import migration15 from "../migrations/0015_video_budget.sql?raw";
import migration17 from "../migrations/0017_first_congregation.sql?raw";

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

  for (const stmt of migration3.split(";").map(s => s.trim()).filter(Boolean)) {
    await db.exec(stmt);
  }

  for (const stmt of migration4.split(";").map(s => s.trim()).filter(Boolean)) {
    await db.exec(stmt);
  }

  // 0005 rebuilds the offerings table, so its CREATE TABLE / INSERT span multiple lines. D1's
  // exec() treats each newline as a statement boundary (see the migration1 loop above), so collapse
  // each statement's whitespace to a single line first.
  for (const stmt of migration5.split(";").map(s => s.trim()).filter(Boolean)) {
    await db.exec(stmt.replace(/\s+/g, " ").trim());
  }

  // 0006 adds the relics table; its CREATE TABLE spans multiple lines, so collapse each
  // statement's whitespace to a single line before exec (same reason as 0005).
  for (const stmt of migration6.split(";").map(s => s.trim()).filter(Boolean)) {
    await db.exec(stmt.replace(/\s+/g, " ").trim());
  }

  // 0007 adds the rites table. Its CREATE TABLE carries inline `-- ...` comments and a multi-line
  // CHECK, so strip line comments FIRST (a `;` inside a comment would otherwise split the statement),
  // then collapse each statement's whitespace to a single line before exec (same reason as 0006).
  for (const stmt of migration7.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean)) {
    await db.exec(stmt.replace(/\s+/g, " ").trim());
  }

  // 0008 adds the vitals + pulse_events tables and seeds pulse_state; strip line comments first
  // (same reason as 0007), then collapse whitespace before exec.
  for (const stmt of migration8.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean)) {
    await db.exec(stmt.replace(/\s+/g, " ").trim());
  }

  // 0009 adds the dreams table; its CREATE TABLE carries inline `-- ...` comments, so strip line
  // comments first (same reason as 0007/0008), then collapse whitespace before exec.
  for (const stmt of migration9.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean)) {
    await db.exec(stmt.replace(/\s+/g, " ").trim());
  }

  // 0010 adds the rate_limits table; its CREATE TABLE carries an inline `-- ...` comment, so strip
  // line comments first (same reason as 0007/0008/0009), then collapse whitespace before exec.
  for (const stmt of migration10.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean)) {
    await db.exec(stmt.replace(/\s+/g, " ").trim());
  }

  // 0011 seeds the 'launched' config flag; its INSERT is preceded by `-- ...` comment lines, so strip
  // line comments first (same reason as 0007/0008/0009/0010), then collapse whitespace before exec.
  for (const stmt of migration11.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean)) {
    await db.exec(stmt.replace(/\s+/g, " ").trim());
  }

  // 0012 evolves pulse_events (ADD COLUMN x3 + INDEX) and drops the vitals table; its leading `-- ...`
  // comment block is stripped first (same reason as 0007-0011), then whitespace collapsed before exec.
  for (const stmt of migration12.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean)) {
    await db.exec(stmt.replace(/\s+/g, " ").trim());
  }

  // 0013 adds the partial-unique sermon index; strip its leading `-- ...` comment block first (same reason
  // as 0007-0012), then collapse whitespace before exec.
  for (const stmt of migration13.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean)) {
    await db.exec(stmt.replace(/\s+/g, " ").trim());
  }

  // 0014 rebuilds dreams for the render state machine (multi-line CREATE/INSERT/DROP/ALTER); strip line
  // comments first (same reason as 0005-0013), then collapse whitespace before exec.
  for (const stmt of migration14.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean)) {
    await db.exec(stmt.replace(/\s+/g, " ").trim());
  }

  // 0015 rebuilds spend to add the 'video' category; same handling as 0014.
  for (const stmt of migration15.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean)) {
    await db.exec(stmt.replace(/\s+/g, " ").trim());
  }

  // 0017 backfills wallets.tally_name (G9); strip its leading `-- ...` comment block first (same
  // reason as 0007-0015), then collapse whitespace before exec. (0016 only adds dreams.posted_at,
  // unrelated to any current test and not yet wired into this helper.)
  for (const stmt of migration17.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean)) {
    await db.exec(stmt.replace(/\s+/g, " ").trim());
  }
}
