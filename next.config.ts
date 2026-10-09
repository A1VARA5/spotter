import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite loads its WebAssembly from disk at runtime; bundling breaks that.
  devIndicators: false,
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
