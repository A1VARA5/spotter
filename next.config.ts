import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite loads its WebAssembly from disk at runtime; bundling breaks that.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
