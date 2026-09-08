/** @type {import('next').NextConfig} */
const nextConfig = {
  // packages/core ships TypeScript source rather than a build step, so Next must compile it.
  transpilePackages: ["@krishichain/core"],
  env: {
    NEXT_PUBLIC_GATEWAY_URL: process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8080",
  },
};

export default nextConfig;
