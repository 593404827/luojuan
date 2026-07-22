import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";

const organizeSchema = z.object({
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
});

type Payload = {
  mode: "random" | "direct" | "continue";
  sourceText: string;
  currentTitle?: string;
  chapterTitle?: string;
};

function buildFallbackDraft(payload: Payload) {
  const clean = payload.sourceText.replace(/\s+/g, " ").trim();
  const sentences = clean.split(/[。！？!?]/).filter(Boolean);
  const firstSentence = sentences[0]?.trim() || clean;
  const title = payload.currentTitle?.trim() || firstSentence.slice(0, 10) || "这一章";

  const content = sentences
    .slice(0, 20)
    .map((s, i) => s.trim())
    .filter(Boolean)
    .join("。")
    .slice(0, 2000);

  return {
    title,
    content: content || "这一段回忆已经先整理成稿了。你可以继续补充当时的人、地方和一句最忘不掉的话，让这一章更像真正写给自己和家人的回忆录。",
    tags: ["回忆录", "人生片段"],
  };
}

function buildPrompt(payload: Payload) {
  return [
    "你是一名温柔的陪谈者+编辑，正在帮用户把口述素材整理成适合成书的章节草稿。",
    "默认用户为70后语境，但不要刻板化表达。",
    "请将素材整理成更像回忆录正文的章节，保持第一人称，语言克制、自然、带一点回望感，不写成采访记录，不写成总结报告。",
    "文风要求：像一个人很多年后慢慢回想自己的人生，把画面、人物、动作和心里的那一点余味写出来；句子不要太满，不要像鸡汤，也不要像新闻稿。",
    "如果素材还不够完整，可以做轻度润色和结构整理，但不能凭空添加年份、地点、人物身份等硬信息。",
    "篇幅要求：根据素材的实质内容量来决定章节长度，素材丰富就写长，素材简短就写短，不做硬性字数限制；结构上可以写多段自然段，按素材包含的内容片段自然分段。",
    "标题尽量像书里的章节名，而不是功能标题；标签控制在2到3个，偏向生活意象和人生主题。",
    "请只输出 JSON，不要加解释，格式必须是：{\"title\":\"...\",\"content\":\"段落1\\n\\n段落2\\n\\n段落3\",\"tags\":[\"标签1\",\"标签2\"]}",
    `当前模式：${payload.mode}`,
    payload.chapterTitle ? `当前章节：${payload.chapterTitle}` : "",
    payload.currentTitle ? `当前草稿标题：${payload.currentTitle}` : "",
    `待整理素材：${payload.sourceText}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }

  const payload = (await request.json()) as Payload;
  const sourceText = payload.sourceText?.trim();
  if (!sourceText) {
    return NextResponse.json({ message: "缺少素材内容" }, { status: 400 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      draft: buildFallbackDraft(payload),
      meta: "当前未配置 DeepSeek，已使用本地整理草稿",
    });
  }

  try {
    const response = await fetch(
      `${process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
          temperature: 0.7,
          messages: [
            {
              role: "user",
              content: buildPrompt(payload),
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({
        draft: buildFallbackDraft(payload),
        meta: `整理接口失败，已回退本地草稿：${errorText}`,
      });
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content?.trim();
    const parsed = organizeSchema.parse(JSON.parse(raw));

    return NextResponse.json({
      draft: parsed,
      meta: "已整理为章节草稿",
    });
  } catch (error) {
    return NextResponse.json({
      draft: buildFallbackDraft(payload),
      meta: `整理异常，已回退本地草稿：${String(error)}`,
    });
  }
}
