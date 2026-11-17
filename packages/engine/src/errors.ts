export type EngineErrorCode =
  | "NET_ERROR"
  | "TIMEOUT"
  | "EMPTY_SEARCH"
  | "RULE_ERROR"
  | "JS_ERROR"
  | "BLOCKED"
  | "VIP_CHAPTER"
  | "TOO_LARGE"
  | "BAD_URL"
  | "UNSUPPORTED_WEBVIEW"
  | "UNSUPPORTED_API";

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EngineError";
  }
}
