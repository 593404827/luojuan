import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["10.83.133.172"],
  serverExternalPackages: ["docx", "pdfkit"],
};

export default nextConfig;
