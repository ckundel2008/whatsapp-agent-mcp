import test from "node:test";
import assert from "node:assert/strict";
import { createWhatsAppService } from "../runtime/service.mjs";

const owner = "fixture_abcdefghijklmnopqrstuvwxyz012345";
function fixture() {
  let clock = 1000, account = "491234567890", sends = 0, result = "sent";
  const client = { getConnectionState: async () => "CONNECTED", getHostNumber: async () => account,
    pup: async (_fn, input) => {
      if (input.operation === "resolveChat") return { id: "111@c.us", formattedTitle: "Fixture", canSend: true };
      if (input.operation === "sendExistingAttachment") { sends++; return { status: result, message_id: "true_111@c.us_FIXTURE" }; }
      throw new Error("Unexpected fixture operation");
    } };
  const service = createWhatsAppService({ client, now: () => clock });
  const staged = async () => {
    const begun = await service.dispatch("beginAttachment", { owner_token: owner, name: "test.txt", mime: "text/plain", size: 3 });
    await service.dispatch("appendAttachment", { owner_token: owner, upload_id: begun.upload_id, offset: 0, data: "YWJj" });
    const prepared = await service.dispatch("prepareAttachment", { owner_token: owner, upload_id: begun.upload_id, chat_id: "111@c.us", text: "" });
    return { begun, prepared };
  };
  return { service, staged, advance: (value) => { clock += value; }, changeAccount: () => { account = "499999999999"; }, unknown: () => { result = "unconfirmed"; }, sends: () => sends };
}

test("attachment approval cannot outlive its upload and expires before a send starts", async () => {
  const f = fixture(); const { begun, prepared } = await f.staged();
  assert.equal(prepared.expires_at, begun.expires_at);
  f.advance(5 * 60 * 1000);
  await assert.rejects(f.service.dispatch("sendPrepared", { approval_id: prepared.approval_id }), /expired/);
  assert.equal(f.sends(), 0);
});

test("account change and concurrent confirmation cannot duplicate an attachment send", async () => {
  const changed = fixture(); const first = await changed.staged(); changed.changeAccount();
  await assert.rejects(changed.service.dispatch("sendPrepared", { approval_id: first.prepared.approval_id }), /account changed/);
  assert.equal(changed.sends(), 0);
  const f = fixture(); const { prepared } = await f.staged();
  const results = await Promise.allSettled([f.service.dispatch("sendPrepared", { approval_id: prepared.approval_id }), f.service.dispatch("sendPrepared", { approval_id: prepared.approval_id })]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(f.sends(), 1);
});

test("unknown media outcome consumes both approval and upload without a retry", async () => {
  const f = fixture(); const { begun, prepared } = await f.staged(); f.unknown();
  await assert.rejects(f.service.dispatch("sendPrepared", { approval_id: prepared.approval_id }), /did not confirm/);
  await assert.rejects(f.service.dispatch("sendPrepared", { approval_id: prepared.approval_id }), /already used/);
  await assert.rejects(f.service.dispatch("prepareAttachment", { owner_token: owner, upload_id: begun.upload_id, chat_id: "111@c.us" }), /unavailable/);
  assert.equal(f.sends(), 1);
});
