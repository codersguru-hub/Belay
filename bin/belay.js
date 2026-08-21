#!/usr/bin/env node
import { main } from "../packages/daemon/dist/cli.js";

void main().catch((error) => {
  process.stderr.write(`[Belay Fatal] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
