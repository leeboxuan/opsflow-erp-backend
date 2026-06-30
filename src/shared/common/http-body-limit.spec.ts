import express from "express";
import request from "supertest";
import { AllExceptionsFilter } from "./all-exceptions.filter";
import { JSON_BODY_LIMIT } from "./http-body.config";

function makeApp(limit = JSON_BODY_LIMIT) {
  const app = express();
  app.use(express.json({ limit }));
  app.use((err: any, _req: any, res: any, next: any) => {
    if (err) {
      new AllExceptionsFilter().catch(err, {
        switchToHttp: () => ({
          getRequest: () => ({}),
          getResponse: () => ({
            status: (code: number) => ({
              json: (body: unknown) => res.status(code).json(body),
            }),
          }),
        }),
      } as any);
      return;
    }
    next();
  });
  app.post("/sign", (req, res) => {
    res.json({ ok: true, hasSignature: !!req.body?.signatureBase64 });
  });
  return app;
}

describe("JSON body limit", () => {
  it("accepts ~105 KB signature JSON payload with 1mb limit", async () => {
    const payload = {
      signatureBase64: "A".repeat(105_000),
      signedByName: "Test Signer",
    };
    const body = JSON.stringify(payload);
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(102_400);

    const res = await request(makeApp())
      .post("/sign")
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, hasSignature: true });
  });

  it("returns 413 for payloads over 1mb limit", async () => {
    const payload = { signatureBase64: "B".repeat(1_100_000) };

    const res = await request(makeApp())
      .post("/sign")
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      statusCode: 413,
      message: "Request payload is too large.",
      error: "Payload Too Large",
    });
  });

  it("still rejects ~105 KB payload when limit remains 100kb", async () => {
    const payload = { signatureBase64: "C".repeat(105_000) };

    const res = await request(makeApp("100kb"))
      .post("/sign")
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(413);
  });
});
