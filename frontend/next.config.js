/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce a standalone build for Docker / Render deployment
  output: "standalone",

  // Allow cross-origin requests from localhost during dev
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};
module.exports = nextConfig;
