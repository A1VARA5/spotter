// One-off: mint an agent key in the local PGlite database, written to a git-ignored file (never printed).
import { writeFileSync } from "node:fs";
import { pgliteDb } from "../src/db";
import { issueAgentToken } from "../src/core/pairing";
const db = await pgliteDb(".data/spotter");
const token = await issueAgentToken(db, process.argv[2]!);
writeFileSync(".secrets/local-agent-token.txt", token);
console.log("token written");
