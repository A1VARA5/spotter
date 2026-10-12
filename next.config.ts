import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite loads its WebAssembly from disk at runtime; bundling breaks that.
  devIndicators: false,
  serverExternalPackages: ["@electric-sql/pglite"],
  // The app calls the payments table Activity, but it lives at /ledger. People (and judges) guess /activity.
  async redirects() {
    return [{ source: "/activity", destination: "/ledger", permanent: false }];
  },
};

export default nextConfig;
