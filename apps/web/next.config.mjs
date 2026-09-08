/** @type {import('next').NextConfig} */
const nextConfig = {
  // packages/core ships TypeScript source rather than a build step, so Next must compile it.
  transpilePackages: ["@krishichain/core"],
  env: {
    NEXT_PUBLIC_GATEWAY_URL: process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8080",
    // S2-12 twins dashboard — browser-side MQTT over WebSocket.
    NEXT_PUBLIC_MQTT_WS_URL: process.env.NEXT_PUBLIC_MQTT_WS_URL ?? "ws://localhost:9001",
  },
  webpack(config) {
    // packages/core's ESM source imports its own siblings with explicit ".js" extensions
    // (the correct TS-ESM convention), but webpack won't resolve those to the ".ts" files
    // that transpilePackages hands it without this alias.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
