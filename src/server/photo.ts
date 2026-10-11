// Real dependencies for the photo price check: Postgres and Channel3, with the daily caps from the environment.
import type { Db } from "@/db";
import { findProductsInImage, searchByImage } from "@/market/channel3";
import type { PhotoDeps } from "@/market/photo";
import { cap } from "@/watchtower/llm";

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
