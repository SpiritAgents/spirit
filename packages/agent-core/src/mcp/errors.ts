export class McpConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpConfigError";
  }
}

export class McpConnectionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpConnectionError";
  }
}

export class McpAppToolApprovalRequiredError extends Error {
  readonly code = "mcp.appToolApprovalRequired";
  readonly server: string;
  readonly toolName: string;

  constructor(server: string, toolName: string) {
    super(`MCP App tool call requires user approval: ${server}/${toolName}`);
    this.name = "McpAppToolApprovalRequiredError";
    this.server = server;
    this.toolName = toolName;
  }
}
