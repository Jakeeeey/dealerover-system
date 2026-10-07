import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
    output: "standalone",
    outputFileTracingRoot: path.join(__dirname),
  /* config options here */
  allowedDevOrigins: ['msi-jake'],
};

export default nextConfig;
