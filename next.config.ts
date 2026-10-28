import type { NextConfig } from "next";

// The Python API lives in api/index.py. Locally it runs under uvicorn on :8000; on Vercel it is a
// Python serverless function, and every /api/py/* request is routed to it.
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/py/:path*",
        destination:
          process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000/api/py/:path*" : "/api/",
      },
    ];
  },
};

export default nextConfig;
