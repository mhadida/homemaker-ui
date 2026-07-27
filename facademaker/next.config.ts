import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const projectRoot = process.cwd();
const hasLocalNext = existsSync(
  path.join(projectRoot, "node_modules", "next", "package.json"),
);

const nextConfig: NextConfig = {
  turbopack: {
    // Use the parent installation while this package lives in the Homemaker
    // workspace; become fully local automatically after a standalone install.
    root: hasLocalNext ? projectRoot : path.resolve(projectRoot, ".."),
  },
};

export default nextConfig;
