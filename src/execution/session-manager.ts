/**
 * Session Manager for 2-way communication.
 * Tracks paused sessions awaiting orchestrator replies.
 */

import type { ModelMessage } from "ai";
import type { Logger } from "pino";
import { createLogger } from "../logger.js";

let log: Logger | null = null;

const getLog = (): Logger => {
  if (!log) {
    log = createLogger("session-manager");
  }
  return log;
};

/**
 * State of a paused session awaiting orchestrator reply.
 */
export interface SessionState {
  sessionId: number;
  toolName: string;
  originalArgs: Record<string, unknown>;
  messages: ModelMessage[];
  question: string;
  createdAt: number;
  resolve: (payload: unknown) => void;
}

/**
 * Manages paused sessions for 2-way communication.
 * Session IDs are 0-999, wrapping around.
 */
export class SessionManager {
  private counter = 0;
  private sessions = new Map<number, SessionState>();

  /**
   * Create a new session and return a promise that resolves when orchestrator replies.
   */
  createSession(
    toolName: string,
    originalArgs: Record<string, unknown>,
    messages: ModelMessage[],
    question: string,
  ): { sessionId: number; waitForReply: Promise<unknown> } {
    const sessionId = this.counter;
    this.counter = (this.counter + 1) % 1000;

    // Clear old session at this ID if exists (wraparound)
    if (this.sessions.has(sessionId)) {
      getLog().warn(
        { sessionId },
        "Overwriting stale session due to ID wraparound",
      );
    }

    let resolveReply: ((payload: unknown) => void) | undefined;
    const waitForReply = new Promise<unknown>((resolve) => {
      resolveReply = resolve;
    });

    if (!resolveReply) {
      throw new Error("Promise executor failed to run synchronously");
    }

    const state: SessionState = {
      sessionId,
      toolName,
      originalArgs,
      messages,
      question,
      createdAt: Date.now(),
      resolve: resolveReply,
    };

    this.sessions.set(sessionId, state);
    getLog().info({ sessionId, toolName, question }, "Session created");

    return { sessionId, waitForReply };
  }

  /**
   * Get session state by ID.
   */
  getSession(sessionId: number): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Resume a paused session with the orchestrator's reply.
   * Returns true if session was found and resumed.
   */
  resumeSession(sessionId: number, payload: unknown): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      getLog().warn({ sessionId }, "Attempted to resume unknown session");
      return false;
    }

    getLog().info({ sessionId, payload }, "Resuming session");
    session.resolve(payload);
    this.sessions.delete(sessionId);
    return true;
  }

  /**
   * Check if a session exists.
   */
  hasSession(sessionId: number): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get count of active sessions.
   */
  get activeCount(): number {
    return this.sessions.size;
  }
}
