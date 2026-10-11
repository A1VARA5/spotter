// Real dependencies for the photo price check: Postgres and Channel3, with the daily caps from the environment.
import type { Db } from "@/db";
import { findProductsInImage, searchByImage } from "@/market/channel3";
import type { PhotoDeps } from "@/market/photo";
import { cap } from "@/watchtower/llm";
import { readScreenshot } from "@/ai/screenshot";
import type { PictureDeps } from "@/core/picture";

/** Screenshot reading: one Claude vision call per picture, capped per family and per day. */
export function pictureDeps(db: Db, householdId: string): PictureDeps {
  return {
    db,
    householdId,
    read: (bytes, type) => readScreenshot(bytes, type),
    perHousehold: cap("VISION_CHECKS_PER_FAMILY", 10),
    overall: cap("VISION_CHECKS_PER_DAY", 200),
  };
}

export function photoDeps(db: Db, householdId: string): PhotoDeps {
  return {
    db,
    householdId,
    find: (base64, currency, condition) => findProductsInImage(base64, currency, condition),
    single: (img, currency, conditions) => searchByImage(img, currency, 10, conditions),
    perHousehold: cap("PHOTO_CHECKS_PER_FAMILY", 5),
    overall: cap("PHOTO_CHECKS_PER_DAY", 100),
  };
}
