import { NextResponse } from "next/server";
import { createSessionToken, getSingleUserCredentials, setSessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const { username, password } = (await request.json()) as {
      username?: string;
      password?: string;
    };

    const creds = getSingleUserCredentials();
    if (username !== creds.username || password !== creds.password) {
      return NextResponse.json({ message: "账号或密码错误" }, { status: 401 });
    }

    await setSessionCookie(createSessionToken(username));
    return NextResponse.json({ ok: true, username });
  } catch (error) {
    return NextResponse.json(
      { message: "登录失败", error: String(error) },
      { status: 500 }
    );
  }
}
