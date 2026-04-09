import { and, eq, not } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import {
  // CallEndedEvent,
  // CallTranscriptionReadyEvent,
  // CallRecordingReadyEvent,
  CallSessionParticipantLeftEvent,
  CallSessionStartedEvent,
} from "@stream-io/node-sdk";

import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { streamVideo } from "@/lib/stream-video";

function verifySignatureWithSDK(body: string, signature: string): boolean {
  return streamVideo.verifyWebhook(body, signature);
};

export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-signature");
  const apiKey = req.headers.get("x-api-key");

  if (!signature || !apiKey) {
    return NextResponse.json(
      { error: "Missing signature or API key" },
      { status: 400 }
    );
  }

  const body = await req.text();

  if (!verifySignatureWithSDK(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = (payload as Record<string, unknown>)?.type;
  console.log("[Webhook] Received event:", eventType);

  if (eventType === "call.session_started") {
    const event = payload as CallSessionStartedEvent;
    const meetingId = event.call.custom?.meetingId;

    if (!meetingId) {
      console.error("[Webhook] Missing meetingId in call.custom");
      return NextResponse.json({ error: "Missing meetingId" }, { status: 400 });
    }

    console.log("[Webhook] Session started for meetingId:", meetingId);

    // ✅ FIX: Removed `not(eq(meetings.status, "active"))` — the AI must be
    // able to join even if the meeting was already transitioned to "active".
    const [existingMeeting] = await db
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.id, meetingId),
          not(eq(meetings.status, "completed")),
          not(eq(meetings.status, "cancelled")),
          not(eq(meetings.status, "processing")),
        )
      );

    if (!existingMeeting) {
      console.error("[Webhook] Meeting not found or in terminal state:", meetingId);
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    // Only update status if not already active
    if (existingMeeting.status !== "active") {
      await db
        .update(meetings)
        .set({ status: "active", startedAt: new Date() })
        .where(eq(meetings.id, existingMeeting.id));
    }

    const [existingAgent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, existingMeeting.agentId));

    if (!existingAgent) {
      console.error("[Webhook] Agent not found:", existingMeeting.agentId);
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    try {
      console.log("[Webhook] Connecting AI agent:", existingAgent.name);
      const call = streamVideo.video.call("default", meetingId);
      const realtimeClient = await streamVideo.video.connectOpenAi({
        call,
        openAiApiKey: process.env.OPENAI_API_KEY!,
        agentUserId: existingAgent.id,
      });

      realtimeClient.updateSession({
        instructions: existingAgent.instructions,
      });
      console.log("[Webhook] AI agent connected successfully!");
    } catch (err) {
      console.error("[Webhook] Failed to connect AI agent:", err);
    }

  } else if (eventType === "call.session_participant_left") {
    const event = payload as CallSessionParticipantLeftEvent;
    const meetingId = event.call_cid.split(":")[1];

    if (!meetingId) {
      return NextResponse.json({ error: "Missing meetingId" }, { status: 400 });
    }

    console.log("[Webhook] Participant left meeting:", meetingId);
    const call = streamVideo.video.call("default", meetingId);
    await call.end();
  }

  return NextResponse.json({ status: "ok" });
}
