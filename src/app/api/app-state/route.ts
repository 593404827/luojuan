import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { loadAppState, loadCommunityWorks, saveAppState } from "@/lib/persistence";

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ message: "未登录" }, { status: 401 });
    }
    const [state, communityWorks] = await Promise.all([
      loadAppState(session.username),
      loadCommunityWorks(),
    ]);
    return NextResponse.json({
      username: session.username,
      state,
      communityWorks,
    });
  } catch (error) {
    return NextResponse.json(
      { message: "读取应用状态失败", error: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ message: "未登录" }, { status: 401 });
    }
    const payload = await request.json();
    const state = await saveAppState(session.username, payload);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { message: "保存应用状态失败", error: String(error) },
      { status: 500 }
    );
  }
}
