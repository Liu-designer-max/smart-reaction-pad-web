import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const samplePath = path.join(root, "samples", "baseline-session.json");
const sample = JSON.parse(fs.readFileSync(samplePath, "utf8"));

const requiredTrialKeys = ["event", "trial", "total", "mode", "zone", "zone_name", "stim", "rt_ms", "result", "peak_adc"];
const validResults = new Set(["go_correct", "false_alarm", "correct_withhold", "miss", "too_fast"]);

if (!Array.isArray(sample.trials) || sample.trials.length === 0) {
  throw new Error("Sample must include trials.");
}

for (const trial of sample.trials) {
  for (const key of requiredTrialKeys) {
    if (!(key in trial)) throw new Error(`Missing trial key: ${key}`);
  }
  if (trial.event !== "trial") throw new Error("Trial event field must equal trial.");
  if (trial.zone < 0 || trial.zone > 5) throw new Error(`Invalid zone: ${trial.zone}`);
  if (!validResults.has(trial.result)) throw new Error(`Invalid result: ${trial.result}`);
}

const valid = sample.trials.filter((trial) => trial.result === "go_correct" && trial.rt_ms >= 50 && trial.rt_ms <= 2000);
const avg = Math.round(valid.reduce((sum, trial) => sum + trial.rt_ms, 0) / valid.length);

if (avg !== sample.summary.avg_ms) {
  throw new Error(`Summary avg_ms ${sample.summary.avg_ms} does not match computed ${avg}.`);
}

console.log(`Validated ${sample.trials.length} sample trials. Mean RT ${avg} ms.`);
