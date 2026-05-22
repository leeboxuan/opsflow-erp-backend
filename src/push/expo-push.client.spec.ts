import { sendExpoPushMessages } from "./expo-push.client";

describe("sendExpoPushMessages", () => {
  it("chunks requests and collects invalid tokens", async () => {
    const firstChunkTickets = Array.from({ length: 100 }, (_, i) =>
      i === 1
        ? ({
            status: "error" as const,
            details: { error: "DeviceNotRegistered" },
          } as const)
        : ({ status: "ok" as const, id: String(i) } as const),
    );
    const sendFn = jest
      .fn()
      .mockResolvedValueOnce(firstChunkTickets)
      .mockResolvedValueOnce([{ status: "ok" as const, id: "100" }]);

    const messages = Array.from({ length: 101 }, (_, i) => ({
      to: `ExponentPushToken[${i}]`,
      title: "T",
      body: "B",
    }));

    const { invalidTokens, tickets } = await sendExpoPushMessages(messages, sendFn);

    expect(sendFn).toHaveBeenCalledTimes(2);
    expect(sendFn.mock.calls[0][0]).toHaveLength(100);
    expect(sendFn.mock.calls[1][0]).toHaveLength(1);
    expect(tickets).toHaveLength(101);
    expect(invalidTokens).toEqual(["ExponentPushToken[1]"]);
  });
});
