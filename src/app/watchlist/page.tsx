"use client";

import { useMarkSeen } from "@/lib/news";
import { Watchlist } from "@/components/Watchlist";
import { PageTitle } from "@/components/ui";

export default function WatchlistPage() {
  useMarkSeen("lists.watchlist");
  return (
    <>
      <PageTitle sub="Was wollen wir zusammen schauen?">Watchlist 📺</PageTitle>
      <Watchlist />
    </>
  );
}
