import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `standalone` keeps the production Docker image small: `next build` emits a
  // self-contained server bundle with only the modules it actually imports.
  output: "standalone",
  reactStrictMode: true,
};

export default nextConfig;
