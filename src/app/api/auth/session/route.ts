import { NextResponse } from "next/server";
import { getCurrentSession, getSingleUserCredentials } from "@/lib/auth";

export async function GET() {
  const session = await getCurrentSession();
  const fallback = getSingleUserCredentials();
  return NextResponse.json({
    authenticated: Boolean(session),
    username: session?.username ?? null,
    hasCustomCredentials:
      Boolean(process.env.SINGLE_USER_USERNAME) && Boolean(process.env.SINGLE_USER_PASSWORD),
    defaultUsernameHint: fallback.username,
  });
}
