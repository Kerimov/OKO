import { createHash, randomUUID } from "node:crypto";
import type { OkoDb } from "../oko-db.js";
import {
  INTEGRATION_CODES,
  type DoXmlReceiveInput,
  type DoXmlReceiveResult,
  type DoXmlTransportPort,
} from "./ports.js";

/**
 * Stub DO XML transport: stores payloads in inbox and rejects parse until XSD is provided.
 * Set OKO_DO_XML_CONFIGURED=1 only after customer XSD is wired.
 */
export class StubDoXmlTransport implements DoXmlTransportPort {
  readonly name = "stub-do-xml";

  constructor(private readonly db: OkoDb) {}

  isConfigured(): boolean {
    return process.env.OKO_DO_XML_CONFIGURED === "1";
  }

  async receive(input: DoXmlReceiveInput): Promise<DoXmlReceiveResult> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const sha =
      input.sha256 ||
      createHash("sha256").update(input.payload, "utf8").digest("hex");

    if (!this.isConfigured()) {
      const errors = [
        INTEGRATION_CODES.DO_XSD_MISSING,
        "Customer DO XML/XSD and delivery reglament are not configured",
      ];
      await this.db
        .prepare(
          `INSERT INTO do_transport_inbox (
             id, filename, sha256, status, received_at, actor, validation_errors, payload
           ) VALUES (?, ?, ?, 'rejected', ?, ?, ?, ?)`
        )
        .run(
          id,
          input.filename,
          sha,
          now,
          input.actor ?? null,
          JSON.stringify(errors),
          input.payload
        );
      return { id, status: "rejected", validationErrors: errors };
    }

    // Configured path still requires a real parser — keep as received for operator review.
    await this.db
      .prepare(
        `INSERT INTO do_transport_inbox (
           id, filename, sha256, status, received_at, actor, validation_errors, payload
         ) VALUES (?, ?, ?, 'received', ?, ?, '[]', ?)`
      )
      .run(id, input.filename, sha, now, input.actor ?? null, input.payload);
    return { id, status: "received", validationErrors: [] };
  }
}

export async function listDoInbox(
  db: OkoDb,
  limit = 100
): Promise<
  Array<{
    id: string;
    filename: string | null;
    status: string;
    receivedAt: string;
    processedAt: string | null;
    validationErrors: string[];
  }>
> {
  const rows = (await db
    .prepare(
      `SELECT id, filename, status, received_at, processed_at, validation_errors
       FROM do_transport_inbox
       ORDER BY received_at DESC
       LIMIT ?`
    )
    .all(limit)) as Array<{
    id: string;
    filename: string | null;
    status: string;
    received_at: string;
    processed_at: string | null;
    validation_errors: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    status: r.status,
    receivedAt: r.received_at,
    processedAt: r.processed_at,
    validationErrors: safeJsonArray(r.validation_errors),
  }));
}

function safeJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
