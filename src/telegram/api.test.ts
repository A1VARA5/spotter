import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFile } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const getFile = (result: Record<string, unknown>, ok = true) => Response.json({ ok, result }, { status: ok ? 200 : 400 });

describe("downloadFile", () => {
  it("asks getFile for the path, then downloads from Telegram's file host", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    const fetchMock = vi.fn(async (url: string) => (url.endsWith("/getFile") ? getFile({ file_path: "photos/file_7.jpg", file_size: 4 }) : new Response(new Uint8Array([1, 2, 3, 4]))));
    vi.stubGlobal("fetch", fetchMock);
    expect(await downloadFile("abc", 100)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(fetchMock.mock.calls[1]![0]).toBe("https://api.telegram.org/file/bot123:abc/photos/file_7.jpg");
  });

  it("refuses a file over the limit before downloading, and a body that turns out bigger", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    const fetchMock = vi.fn(async () => getFile({ file_path: "photos/a.jpg", file_size: 5000 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await downloadFile("abc", 100)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/getFile") ? getFile({ file_path: "photos/a.jpg" }) : new Response(new Uint8Array(500)))));
    expect(await downloadFile("abc", 100)).toBeNull();
  });

  it("refuses odd paths and failed answers, and never throws", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    for (const file_path of ["../secret", "photos/../../x", "https://evil.example/a.jpg", "photos/a b.jpg"]) {
      vi.stubGlobal("fetch", vi.fn(async () => getFile({ file_path })));
      expect(await downloadFile("abc", 100)).toBeNull();
    }
    vi.stubGlobal("fetch", vi.fn(async () => getFile({}, false)));
    expect(await downloadFile("abc", 100)).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    expect(await downloadFile("abc", 100)).toBeNull();
  });
});
