import { beforeAll, describe, expect, it } from "vitest";
import { initLogger } from "../logger.js";
import { SessionManager } from "./session-manager.js";

describe("SessionManager", () => {
  beforeAll(() => {
    initLogger({ level: "silent", pretty: false });
  });
  it("should create sessions with incrementing IDs", () => {
    const manager = new SessionManager();
    const messages = [{ role: "user" as const, content: "test" }];

    const { sessionId: id1 } = manager.createSession(
      "tool1",
      { arg: "value" },
      messages,
      "Question 1?",
    );
    const { sessionId: id2 } = manager.createSession(
      "tool2",
      { arg: "value2" },
      messages,
      "Question 2?",
    );

    expect(id1).toBe(0);
    expect(id2).toBe(1);
    expect(manager.activeCount).toBe(2);
  });

  it("should wrap around at 1000", () => {
    const manager = new SessionManager();
    const messages = [{ role: "user" as const, content: "test" }];

    // Create 1000 sessions
    for (let i = 0; i < 1000; i++) {
      manager.createSession("tool", {}, messages, `Q${i}`);
    }

    // Next session should wrap to 0
    const { sessionId } = manager.createSession("tool", {}, messages, "wrap");
    expect(sessionId).toBe(0);
  });

  it("should store and retrieve session state", () => {
    const manager = new SessionManager();
    const messages = [{ role: "user" as const, content: "test prompt" }];
    const args = { query: "test" };

    manager.createSession("docs_search", args, messages, "Which version?");

    const session = manager.getSession(0);
    expect(session).toBeDefined();
    expect(session?.toolName).toBe("docs_search");
    expect(session?.originalArgs).toEqual(args);
    expect(session?.question).toBe("Which version?");
  });

  it("should resume session and remove it", async () => {
    const manager = new SessionManager();
    const messages = [{ role: "user" as const, content: "test" }];

    const { sessionId, waitForReply } = manager.createSession(
      "tool",
      {},
      messages,
      "Question?",
    );

    // Resume in next tick
    setTimeout(() => {
      manager.resumeSession(sessionId, { answer: "v3" });
    }, 10);

    const payload = await waitForReply;
    expect(payload).toEqual({ answer: "v3" });
    expect(manager.hasSession(sessionId)).toBe(false);
  });

  it("should return false for unknown session", () => {
    const manager = new SessionManager();
    expect(manager.resumeSession(999, {})).toBe(false);
  });

  it("should check session existence", () => {
    const manager = new SessionManager();
    const messages = [{ role: "user" as const, content: "test" }];

    expect(manager.hasSession(0)).toBe(false);

    manager.createSession("tool", {}, messages, "Q?");

    expect(manager.hasSession(0)).toBe(true);
    expect(manager.hasSession(1)).toBe(false);
  });
});
