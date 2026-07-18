import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { loadAppState, loadCommunityWorks, publishChapterToCommunity } from "@/lib/persistence";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ message: "未登录" }, { status: 401 });
    }

    const { chapterId } = (await request.json()) as { chapterId?: string };
    if (!chapterId) {
      return NextResponse.json({ message: "缺少章节编号" }, { status: 400 });
    }

    const state = await loadAppState(session.username);
    const chapter = state.chapters.find((item) => item.id === chapterId);
    if (!chapter) {
      return NextResponse.json({ message: "没有找到这个章节" }, { status: 404 });
    }

    const published = await publishChapterToCommunity(session.username, chapter);
    const communityWorks = await loadCommunityWorks();

    return NextResponse.json({
      ok: true,
      published,
      communityWorks,
      message: "已发布到社区",
    });
  } catch (error) {
    return NextResponse.json(
      { message: "发布失败", error: String(error) },
      { status: 500 }
    );
  }
}
