"use client";

import { useMarkSeen } from "@/lib/news";
import { Pinboard } from "@/components/Pinboard";

export default function PinnwandPage() {
  useMarkSeen("start");
  return <Pinboard />;
}
