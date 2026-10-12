// Whether this browser turned recording mode on (?rec=1, see src/proxy.ts and src/core/recording.ts).
import { cookies } from "next/headers";
import { REC_COOKIE } from "@/core/recording";

export async function recOn(): Promise<boolean> {
  return (await cookies()).get(REC_COOKIE)?.value === "1";
}
