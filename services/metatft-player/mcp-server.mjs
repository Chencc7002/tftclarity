#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPlayerMatchMcpServer } from "./mcp-tools.mjs";

await createPlayerMatchMcpServer().connect(new StdioServerTransport());
