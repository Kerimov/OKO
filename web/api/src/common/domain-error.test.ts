import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { domainErrorBody, resolveDomainHttpStatus } from "./domain-error.js";

describe("resolveDomainHttpStatus", () => {
  it("honours explicit status codes", () => {
    assert.equal(resolveDomainHttpStatus({ status: 403, message: "no" }), 403);
    assert.equal(resolveDomainHttpStatus({ status: 422, message: "bad" }), 422);
    assert.equal(resolveDomainHttpStatus({ status: 400, message: "x" }), 400);
  });

  it("maps known validation phrases to 400", () => {
    assert.equal(resolveDomainHttpStatus({ message: "period is closed" }), 400);
    assert.equal(resolveDomainHttpStatus({ message: "комплект неполон" }), 400);
    assert.equal(resolveDomainHttpStatus({ message: "User not found" }), 400);
  });

  it("defaults unknown errors to 500", () => {
    assert.equal(resolveDomainHttpStatus({ message: "connection reset" }), 500);
    assert.equal(resolveDomainHttpStatus({}), 500);
  });
});

describe("domainErrorBody", () => {
  it("keeps statusCode and message for client errors", () => {
    const body = domainErrorBody({ message: "period is closed" }, 400);
    assert.equal(body.statusCode, 400);
    assert.equal(body.error, "period is closed");
    assert.equal(body.message, "period is closed");
  });

  it("uses toJSON for 422 when present", () => {
    const body = domainErrorBody(
      {
        message: "validation",
        toJSON: () => ({ error: "validation", result: { ok: false } }),
      },
      422
    );
    assert.equal(body.statusCode, 422);
    assert.equal(body.error, "validation");
    assert.deepEqual(body.result, { ok: false });
  });
});
