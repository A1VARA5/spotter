"use client";
// Photo price check on the dashboard: one photo, each thing in it boxed and priced against real shops. The photo is
// shrunk in the browser (so it uploads fast), sent once, and never stored by Spotter.
import { useEffect, useId, useRef, useState } from "react";
import { Camera, ImageUp } from "lucide-react";
import type { PhotoItem, PhotoMode, PhotoResult } from "@/market/photo";
import { money } from "./format";
import { plainError, readJson } from "./http";

const MAX_EDGE = 1600;
const EXAMPLE = "/examples/living-room.jpg";
const HTTPS = /^https:\/\/[^\s"<>]+$/;

type Picked = { url: string; base64: string; example: boolean; name: string };
type What = "auto" | "message" | "prices";
type Words = { from: string | null; text: string; injection: boolean; check: { signs: boolean; text: string[] } };

/** Shrinks any photo the browser can open to a JPEG no wider or taller than MAX_EDGE. */
async function prepare(blob: Blob): Promise<{ blob: Blob; base64: string }> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    throw new Error("That file isn't a photo this browser can open. Use a JPEG, PNG or WEBP photo.");
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const out = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.86));
  if (!out) throw new Error("Couldn't read that photo. Try another one.");
  const base64 = await new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => fail(new Error("Couldn't read that photo. Try another one."));
    r.readAsDataURL(out);
  });
  return { blob: out, base64 };
}

export function PhotoCheck() {
  const id = useId();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [mode, setMode] = useState<PhotoMode>("buy");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [what, setWhat] = useState<What>("auto");
  const [result, setResult] = useState<PhotoResult | null>(null);
  const [words, setWords] = useState<Words | null>(null);
  const [ask, setAsk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  // Object URLs are freed when the photo changes and when the panel goes.
  useEffect(() => () => void (picked && URL.revokeObjectURL(picked.url)), [picked]);
  useEffect(() => {
    if (result || words || ask) resultRef.current?.focus();
  }, [result, words, ask]);

  const clear = () => {
    setResult(null);
    setWords(null);
    setAsk(false);
  };

  async function use(blob: Blob, example: boolean, name: string) {
    setError(null);
    clear();
    try {
      const p = await prepare(blob);
      setPicked({ url: URL.createObjectURL(p.blob), base64: p.base64, example, name });
    } catch (e) {
      setPicked(null);
      setError(plainError(e));
    }
  }

  async function example() {
    try {
      const r = await fetch(EXAMPLE);
      if (!r.ok) throw new Error("The example photo didn't load. Try your own photo instead.");
      setWhat("prices");
      setMode("buy");
      setAmount("49");
      await use(await r.blob(), true, "Example living room photo");
    } catch (e) {
      setError(plainError(e));
    }
  }

  async function check(choice: What = what) {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    clear();
    try {
      const r = await fetch("/api/photo-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: picked.base64, mode, amount: choice === "message" ? "" : amount, what: choice === "auto" ? null : choice }),
      });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error ?? `Something went wrong (${r.status}).`);
      if (j.ask === true) setAsk(true);
      else if (j.words && typeof j.words.text === "string" && Array.isArray(j.words.check?.text)) setWords(j.words as Words);
      else if (j.result && Array.isArray(j.result.items)) setResult(j.result as PhotoResult);
      else throw new Error("Spotter replied unexpectedly. Try again.");
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  }

  const size = result?.size;
  return (
    <section className="photo" aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className="section-title" style={{ marginTop: 6 }}>
        Check a photo or a screenshot
      </h2>
      <p className="feed-meta">
        A screenshot of a text asking for money, a quote on the doorstep, a &quot;whole room for £49&quot; ad, or things someone wants to buy from your family. Spotter
        reads the message and checks it, or finds each thing and prices it at real shops. Nothing is paid and the photo isn&apos;t kept.
      </p>

      <div className="photo-form">
        <div className="photo-pick">
          <input
            ref={fileRef}
            id={`${id}-f`}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void use(f, false, f.name);
              e.target.value = "";
            }}
          />
          <label htmlFor={`${id}-f`} className="btn btn-quiet photo-choose">
            <ImageUp size={18} aria-hidden="true" /> {picked ? "Choose another photo" : "Choose a photo"}
          </label>
          <button type="button" className="btn btn-quiet photo-example" onClick={example}>
            <Camera size={18} aria-hidden="true" /> Try the example photo
          </button>
        </div>

        <fieldset className="photo-mode">
          <legend className="photo-label">What is it?</legend>
          <label>
            <input type="radio" name={`${id}-w`} value="auto" checked={what === "auto"} onChange={() => setWhat("auto")} /> Let Spotter work it out
          </label>
          <label>
            <input type="radio" name={`${id}-w`} value="message" checked={what === "message"} onChange={() => setWhat("message")} /> A screenshot of a message
          </label>
          <label>
            <input type="radio" name={`${id}-w`} value="prices" checked={what === "prices"} onChange={() => setWhat("prices")} /> Things with prices
          </label>
        </fieldset>

        {what !== "message" && (
          <>
            <fieldset className="photo-mode">
              <legend className="photo-label">If it&apos;s things with prices</legend>
              <label>
                <input type="radio" name={`${id}-m`} value="buy" checked={mode === "buy"} onChange={() => setMode("buy")} /> Someone is selling these to us, or quoting for them
              </label>
              <label>
                <input type="radio" name={`${id}-m`} value="sell" checked={mode === "sell"} onChange={() => setMode("sell")} /> Someone wants to buy these from us
              </label>
            </fieldset>

            <label className="photo-label" htmlFor={`${id}-a`}>
              {mode === "buy" ? "Their price for all of it" : "What they offered"} <span className="photo-optional">(optional)</span>
            </label>
            <input
              id={`${id}-a`}
              className="photo-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="For example 49"
              value={amount}
              maxLength={20}
              onChange={(e) => setAmount(e.target.value)}
            />
          </>
        )}

        <button type="button" className="btn btn-primary photo-go" aria-disabled={busy} disabled={!picked} onClick={() => check()}>
          {busy ? "Checking" : what === "message" ? "Check this message" : what === "prices" ? "Check prices" : "Check it"}
        </button>
        {busy && (
          <p className="feed-meta" role="status">
            Looking at the photo. This can take up to half a minute.
          </p>
        )}
        {error && (
          <p className="error-line" role="alert">
            {error}
          </p>
        )}
      </div>

      {picked && (
        <figure className="photo-figure">
          <div className="photo-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={picked.url} alt={picked.example ? "Example photo of a living room with a blue sofa, a white chair, a floor lamp, a sideboard and curtains" : `Your photo: ${picked.name}`} />
            {size &&
              result.items.map((i) =>
                i.bbox ? (
                  <span
                    key={i.n}
                    className="photo-box"
                    data-found={i.found}
                    data-hot={hot === i.n}
                    aria-hidden="true"
                    style={{
                      left: `${(i.bbox[0] / size[0]) * 100}%`,
                      top: `${(i.bbox[1] / size[1]) * 100}%`,
                      width: `${((i.bbox[2] - i.bbox[0]) / size[0]) * 100}%`,
                      height: `${((i.bbox[3] - i.bbox[1]) / size[1]) * 100}%`,
                    }}
                  >
                    <span className="photo-num">{i.n}</span>
                  </span>
                ) : null,
              )}
          </div>
          {picked.example && (
            <figcaption className="photo-credit">
              <b>Example.</b> Photo by Jarosław Ceborski, public domain (CC0), cropped.
            </figcaption>
          )}
        </figure>
      )}

      {ask && (
        <div className="photo-result">
          <h3 ref={resultRef} tabIndex={-1} className="photo-total">
            Is this a message someone sent, or things with prices?
          </h3>
          <div className="photo-pick">
            <button type="button" className="btn btn-quiet" onClick={() => (setWhat("message"), void check("message"))}>
              Check this message
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => (setWhat("prices"), void check("prices"))}>
              Check these prices
            </button>
          </div>
        </div>
      )}

      {words && (
        <div className="photo-result">
          <h3 ref={resultRef} tabIndex={-1} className="photo-total">
            {words.check.text[0]}
          </h3>
          {words.check.text.length > 1 && (
            <ul className="photo-words-check" data-alarm={words.check.signs}>
              {words.check.text.slice(1).map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          <figure className="photo-words">
            <figcaption>
              <b>Read from the screenshot</b>
              {words.from ? ` · appears to be from ${words.from}` : ""}
            </figcaption>
            <blockquote>{words.text}</blockquote>
            {words.injection && <p className="photo-words-note">Some words in the picture try to give orders to an AI. Spotter treated them as part of the message.</p>}
          </figure>
        </div>
      )}

      {result && (
        <div className="photo-result">
          <h3 ref={resultRef} tabIndex={-1} className="photo-total">
            {result.total}
          </h3>
          {(result.quote || result.verdict) && (
            <p className="photo-quote" data-alarm={Boolean(result.verdict)}>
              {result.quote} {result.verdict}
            </p>
          )}
          <ol className="photo-items">
            {result.items.map((i) => (
              <li key={i.n} data-found={i.found} onMouseEnter={() => setHot(i.n)} onMouseLeave={() => setHot(null)}>
                <span className="photo-num" aria-hidden="true">
                  {i.n}
                </span>
                <Item i={i} mode={result.mode} currency={result.currency} />
              </li>
            ))}
          </ol>
          <p className="spot-source">
            {result.fallback ? "Spotter searched with the whole photo, because finding each thing didn't work this time. " : ""}
            Real shop prices (Channel3), {result.mode === "buy" ? "new" : "used"} ones only. A thing with a model number is only priced when the best matches agree
            on the exact model. Everyday things like a sofa or a lamp are priced from similar ones of the same kind, and say so.
          </p>
        </div>
      )}
    </section>
  );
}

function Item({ i, mode, currency }: { i: PhotoItem; mode: PhotoMode; currency: string }) {
  if (!i.found) {
    return (
      <span>
        <b>{i.thing}</b> Couldn&apos;t find this one, so it has no price.
      </span>
    );
  }
  const range = i.low === i.high ? `about ${money(i.low, currency)}` : `${money(i.low, currency)} to ${money(i.high, currency)}`;
  const price =
    i.match === "similar"
      ? mode === "buy"
        ? `Similar ones mostly cost ${range} at real shops, not this exact one`
        : `Similar used ones mostly sell for ${range}, not this exact one`
      : mode === "buy"
        ? `About ${money(i.typical, currency)} at real shops`
        : i.low === i.high
          ? `Used ones sell for about ${money(i.low, currency)}`
          : `Used ones sell for ${money(i.low, currency)} to ${money(i.high, currency)}`;
  return (
    <span>
      <b>{i.thing}</b> {price}. <span className="photo-match">{i.match === "similar" ? `For example: ${i.title}` : i.title}</span>{" "}
      {HTTPS.test(i.cheapest.url) && (
        <a href={i.cheapest.url} target="_blank" rel="noopener noreferrer nofollow">
          {money(i.cheapest.price, currency)} at {i.cheapest.domain}
        </a>
      )}
    </span>
  );
}
