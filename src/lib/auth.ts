import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE = "luojuan_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function getSecret() {
  return process.env.AUTH_SESSION_SECRET || "luojuan-dev-secret";
}

export function getSingleUserCredentials() {
  return {
    username: process.env.SINGLE_USER_USERNAME || "mama",
    password: process.env.SINGLE_USER_PASSWORD || "luojuan123",
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
