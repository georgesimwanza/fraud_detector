import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev-mode "N" badge overlaps the UI and shows up in screenshots; build errors still show in the overlay.
  devIndicators: false,
};

export default nextConfig;
