"use client";

import { Watchlist } from "@/components/Watchlist";
import { PageTitle } from "@/components/ui";

export default function WatchlistPage() {
  return (
    <>
      <PageTitle sub="Was wollen wir zusammen schauen?">Watchlist 📺</PageTitle>
      <Watchlist />
    </>
  );
}
