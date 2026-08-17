#!/usr/bin/env node
import { main } from "../packages/daemon/dist/cli.js";

void main().catch((error) => {
  process.stderr.write(`[AgentMesh Fatal] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
