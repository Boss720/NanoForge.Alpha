/**
 * Base error class for all NanoForge SDK errors.
 */
export class NanoForgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NanoForgeError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when network or WebSocket connection fails.
 */
export class ConnectionError extends NanoForgeError {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

/**
 * Thrown when authentication or token validation fails (Close code 4401).
 */
export class AuthenticationError extends NanoForgeError {
  constructor(message: string = "Authentication failed: invalid or expired token") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/**
 * Thrown when an RPC or network operation times out.
 */
export class TimeoutError extends NanoForgeError {
  constructor(message: string = "Operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Thrown on protocol or schema violations (Close code 4400).
 */
export class ProtocolError extends NanoForgeError {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

/**
 * Thrown when a tool or operation is denied by the user or security policy.
 */
export class ApprovalDeniedError extends NanoForgeError {
  public readonly reason?: string;

  constructor(message: string = "Action was denied by policy or user", reason?: string) {
    super(message);
    this.name = "ApprovalDeniedError";
    this.reason = reason;
  }
}
