import { writeFileSync } from "node:fs";

const [outputPath, ...argumentsReceived] = process.argv.slice(2);
if (!outputPath) throw new Error("job argument fixture requires an output path");
writeFileSync(outputPath, JSON.stringify({
  pid: process.pid,
  argumentsReceived,
}));
