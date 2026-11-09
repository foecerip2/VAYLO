import { describe, expect, it } from "vitest";
import { createFakeApi, FAKE_CODE } from "./fake";

async function signedIn() {
  const api = createFakeApi();
  await api.requestCode("+79991234567");
  await api.verifyCode("+79991234567", FAKE_CODE);
  await api.updateProfile("Тест");
  return api;
}

describe("fake api", () => {
  it("rejects bad phone and wrong code", async () => {
    const api = createFakeApi();
    await expect(api.requestCode("123")).rejects.toMatchObject({ code: "invalid_phone" });
    await api.requestCode("+79991234567");
    await expect(api.verifyCode("+79991234567", "00000")).rejects.toMatchObject({ code: "wrong_code" });
  });
  it("blocks after 5 wrong attempts", async () => {
    const api = createFakeApi();
    await api.requestCode("+79991234567");
    for (let i = 0; i < 5; i++) await api.verifyCode("+79991234567", "0").catch(() => {});
    await expect(api.verifyCode("+79991234567", FAKE_CODE)).rejects.toMatchObject({ code: "too_many_attempts" });
  });
  it("requires a profile name for new users", async () => {
    const api = createFakeApi();
    await api.requestCode("+79991234567");
    const r = await api.verifyCode("+79991234567", FAKE_CODE);
    expect(r.needsProfile).toBe(true);
    await expect(api.updateProfile("  ")).rejects.toMatchObject({ code: "empty" });
  });
  it("assigns increasing seq and does not duplicate retries", async () => {
    const api = await signedIn();
    const a = await api.sendMessage("c_empty", "k1", "один");
    const retry = await api.sendMessage("c_empty", "k1", "один");
    const b = await api.sendMessage("c_empty", "k2", "два");
    expect(retry.id).toBe(a.id);
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(await api.listMessages("c_empty")).toHaveLength(2);
  });
  it("rejects empty messages", async () => {
    const api = await signedIn();
    await expect(api.sendMessage("c_empty", "k", "   ")).rejects.toMatchObject({ code: "empty" });
  });
  it("counts unread and read pointer only moves forward", async () => {
    const api = await signedIn();
    let team = (await api.listChats()).find((c) => c.id === "c_team")!;
    expect(team.unread).toBe(3);
    await api.markRead("c_team", 3);
    await api.markRead("c_team", 1);
    team = (await api.listChats()).find((c) => c.id === "c_team")!;
    expect(team.unread).toBe(0);
  });
  it("sorts pinned first then by recency", async () => {
    const api = await signedIn();
    const ids = (await api.listChats()).map((c) => c.id);
    expect(ids[0]).toBe("c_team");
  });
});

describe("markRead events", () => {
  it("emits only when the pointer moves", async () => {
    const api = await signedIn();
    let n = 0;
    api.subscribe(() => n++);
    await api.markRead("c_team", 3);
    await api.markRead("c_team", 3);
    await api.markRead("c_team", 2);
    expect(n).toBe(1);
  });
});
