import { NextResponse } from "next/server";
import { createSessionToken, getAccountByUsername, setSessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const { username, password } = (await request.json()) as {
      username?: string;
      password?: string;
    };

    const account = getAccountByUsername(username);
    if (!account || password !== account.password) {
      return NextResponse.json({ message: "账号或密码错误" }, { status: 401 });
    }

    await setSessionCookie(createSessionToken(account.username));
    return NextResponse.json({
      ok: true,
      username: account.username,
      displayName: account.displayName,
    });
  } catch (error) {
    return NextResponse.json(
      { message: "登录失败", error: String(error) },
      { status: 500 }
    );
  }
}
