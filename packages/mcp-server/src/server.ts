#!/usr/bin/env node
import {
  createChildProcessCliRunner,
  createMcpMessageParser,
  encodeMcpMessage,
  handleMcpRequest
} from "./index.js";

const runner = createChildProcessCliRunner();
const parse = createMcpMessageParser((request) => {
  void handleMcpRequest(request, runner).then((response) => {
    if (response) process.stdout.write(encodeMcpMessage(response));
  });
});

process.stdin.on("data", parse);
