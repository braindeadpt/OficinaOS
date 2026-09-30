import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamChat } from "../stream.js";

function mockPrisma() {
  return {
    aiAgentDefinition: { findFirst: vi.fn().mockResolvedValue(null) },
    aiConversation: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    aiMessage: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as any;
}

const settings = {
  apiKeyEncrypted: "sk-test",
  endpointUrl: "https://llm.local/v1",
} as any;

describe("streamChat conversation ownership", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("rejects a caller-supplied conversationId owned by another user", async () => {
    prisma.aiConversation.findFirst.mockResolvedValue(null);

    await expect(
      streamChat({
        conversationId: "conv-victim",
        message: "hello",
        prisma,
        settings,
        userId: "user-attacker",
      })
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });

    // The ownership probe is scoped to the caller, and no message may be
    // written into a foreign conversation.
    expect(prisma.aiConversation.findFirst).toHaveBeenCalledWith({
      where: { id: "conv-victim", userId: "user-attacker" },
      select: { id: true },
    });
    expect(prisma.aiMessage.create).not.toHaveBeenCalled();
  });
});
