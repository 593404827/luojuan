import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "luojuan_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export type AccountProfile = {
  username: string;
  password: string;
  displayName: string;
  authorLabel: string;
  bookTitle: string;
};

function isTruthyEnv(value?: string) {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function isEasyAccessEnabled() {
  return isTruthyEnv(process.env.LUOJUAN_EASY_ACCESS);
}

function normalizeAccount(input: Partial<AccountProfile> | null | undefined): AccountProfile | null {
  const username = input?.username?.trim();
  const password = input?.password?.trim();
  if (!username || !password) return null;
  return {
    username,
    password,
    displayName: input?.displayName?.trim() || username,
    authorLabel: input?.authorLabel?.trim() || input?.displayName?.trim() || username,
    bookTitle: input?.bookTitle?.trim() || "回忆录",
  };
}

export function getConfiguredAccounts(): AccountProfile[] {
  const accounts = [
    normalizeAccount({
      username: process.env.LUOJUAN_ACCOUNT_1_USERNAME,
      password: process.env.LUOJUAN_ACCOUNT_1_PASSWORD,
      displayName: process.env.LUOJUAN_ACCOUNT_1_NAME,
      authorLabel: process.env.LUOJUAN_ACCOUNT_1_LABEL,
      bookTitle: process.env.LUOJUAN_ACCOUNT_1_BOOK_TITLE,
    }),
    normalizeAccount({
      username: process.env.LUOJUAN_ACCOUNT_2_USERNAME,
      password: process.env.LUOJUAN_ACCOUNT_2_PASSWORD,
      displayName: process.env.LUOJUAN_ACCOUNT_2_NAME,
      authorLabel: process.env.LUOJUAN_ACCOUNT_2_LABEL,
      bookTitle: process.env.LUOJUAN_ACCOUNT_2_BOOK_TITLE,
    }),
  ].filter(Boolean) as AccountProfile[];

  if (accounts.length > 0) return accounts;

  return [
    {
      username: "0822",
      password: "0822",
      displayName: "我",
      authorLabel: "0822",
      bookTitle: "我的回忆录",
    },
    {
      username: "0116",
      password: "0116",
      displayName: "亲友",
      authorLabel: "0116",
      bookTitle: "我的回忆录",
    },
  ];
}

export function getAccountByUsername(username?: string | null) {
  if (!username) return null;
  return getConfiguredAccounts().find((account) => account.username === username) ?? null;
}

function getSecret() {
  return process.env.AUTH_SESSION_SECRET || "luojuan-dev-secret";
}

export function getSingleUserCredentials() {
  const [firstAccount] = getConfiguredAccounts();
  return {
    username: firstAccount?.username || "0822",
    password: firstAccount?.password || "0822",
  };
}

function sign(payload: string) {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function createSessionToken(username: string) {
  const expiresAt = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `${username}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token?: string | null) {
  if (!token) return null;

  const [username, expiresAtText, signature] = token.split(".");
  if (!username || !expiresAtText || !signature) return null;

  const payload = `${username}.${expiresAtText}`;
  const expected = sign(payload);

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  const expiresAt = Number(expiresAtText);
  if (Number.isNaN(expiresAt) || expiresAt < Date.now()) {
    return null;
  }

  return { username, expiresAt };
}

export async function getCurrentSession() {
  if (isEasyAccessEnabled()) {
    return {
      username: process.env.LUOJUAN_EASY_ACCESS_NAME || "用户",
      expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
    };
  }
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
