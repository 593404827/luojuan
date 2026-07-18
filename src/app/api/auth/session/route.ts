import { NextResponse } from "next/server";
import {
  getConfiguredAccounts,
  getCurrentSession,
  getSingleUserCredentials,
  isEasyAccessEnabled,
} from "@/lib/auth";

export async function GET() {
  const session = await getCurrentSession();
  const fallback = getSingleUserCredentials();
  const easyAccess = isEasyAccessEnabled();
  const accounts = getConfiguredAccounts();
  return NextResponse.json({
    authenticated: Boolean(session),
    username: session?.username ?? null,
    easyAccess,
    hasCustomCredentials: accounts.length > 0,
    accounts: accounts.map((account) => ({
      username: account.username,
      displayName: account.displayName,
      authorLabel: account.authorLabel,
    })),
    defaultUsernameHint: fallback.username,
  });
}
