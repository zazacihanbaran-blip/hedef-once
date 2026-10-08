import path from "node:path";
import { fileURLToPath } from "node:url";
import { labelMaturedSignals } from "../lib/labeler.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
console.log(JSON.stringify(await labelMaturedSignals(path.join(root, "data")), null, 2));

