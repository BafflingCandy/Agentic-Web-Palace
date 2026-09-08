"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_URL, api } from "@/lib/agentApi";

type Palace = { id: string; title: string; subject: string; audience: string; summary: string; run_id: string; accepted_at: string };

export function GeneratedPalace({ projectId }: { projectId: string | null }) {
  const [palace, setPalace] = useState<Palace | null>(null);
  const [message, setMessage] = useState("Loading accepted website…");
  useEffect(() => { api<Palace[]>("/api/palaces").then((items) => { const match = items.find((item) => item.id === projectId) ?? null; setPalace(match); setMessage(match ? "" : "This accepted website is not available in the local agent registry."); }).catch((error) => setMessage(error.message)); }, [projectId]);
  return <main className="generated-palace"><nav><Link href="/?skipIntro=1">← Web Palace brain</Link><Link href="/create">Create another</Link></nav>{palace ? <article><p>Reviewer accepted · {new Date(palace.accepted_at).toLocaleDateString()}</p><h1>{palace.title}</h1><h2>{palace.subject}</h2><p>{palace.summary}</p><dl><div><dt>Audience</dt><dd>{palace.audience}</dd></div><div><dt>Run</dt><dd>{palace.run_id}</dd></div></dl><a href={`${API_URL}/api/runs/${palace.run_id}/download`}>Download website ZIP</a></article> : <p className="generated-message">{message}</p>}</main>;
}
