// Dev only: the toolkit coverage view on its own, for screenshots and for whoever mounts it (agent connect panel, /checks).
import { notFound } from "next/navigation";
import { ToolkitCoverage } from "@/ui/ToolkitCoverage";

export default async function ToolkitShot({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  if (process.env.VERCEL_ENV === "production") notFound();
  const job = (await searchParams).job === "selling" ? "selling" : "shopping";
  return (
    <main style={{ padding: "32px var(--gutter)", maxWidth: 1600, margin: "0 auto", background: "var(--chalk)", minHeight: "100vh" }}>
      <ToolkitCoverage job={job} />
    </main>
  );
}
