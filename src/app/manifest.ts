import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WG-App",
    short_name: "WG",
    description: "Putzplan, Einkaufsliste, Kosten, Kalender und To-dos für eure WG",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f5",
    theme_color: "#4f46e5",
    lang: "de",
    // Android: "Teilen" in Spotify → WG-App → Playlist landet in der Musikliste
    share_target: {
      action: "/musik/teilen",
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      params: { title: "title", text: "text", url: "url" },
    },
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
