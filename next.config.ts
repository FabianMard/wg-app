import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Verenas Kunstwerke: Vercel verkleinert die (teils riesigen) Originale einmal und liefert danach die fertige, kleine Fassung
    remotePatterns: [{ protocol: "https", hostname: "verenapluempe.wordpress.com", pathname: "/wp-content/uploads/**" }],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 Tage zwischenspeichern
  },
};

export default nextConfig;
