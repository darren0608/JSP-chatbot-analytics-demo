/** @type {import('next').NextConfig} */
const backend = process.env.BACKEND_URL || "http://localhost:8000";

const nextConfig = {
  async rewrites() {
    // Same-origin proxy to the FastAPI backend so the httpOnly session cookie
    // just works without CORS gymnastics.
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
