import { NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { getCurrentSession } from "@/lib/auth";
import { loadAppState } from "@/lib/persistence";

export const runtime = "nodejs";

function safeFileName(name: string) {
  return name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function asciiFileName(name: string) {
  return name.replace(/[^\x20-\x7E]/g, "_");
}

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ message: "未登录" }, { status: 401 });
    }

    const state = await loadAppState(session.username);
    const bookTitle = state.bookTitle?.trim() || "落卷回忆录";
    const now = new Date();
    const dateTag = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;

    const children: Paragraph[] = [];

    children.push(
      new Paragraph({
        text: bookTitle,
        heading: HeadingLevel.TITLE,
      })
    );
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `导出日期：${dateTag}`,
            color: "666666",
          }),
        ],
      })
    );
    children.push(new Paragraph({ text: "" }));

    if (state.chapters.length === 0) {
      children.push(
        new Paragraph({
          text: "（当前还没有收录章节）",
          heading: HeadingLevel.HEADING_2,
        })
      );
      if (state.draft?.content?.trim()) {
        children.push(
          new Paragraph({
            text: state.draft.title?.trim() || "未收录草稿",
            heading: HeadingLevel.HEADING_3,
          })
        );
        children.push(new Paragraph({ text: state.draft.content.trim() }));
      }
    } else {
      state.chapters.forEach((chapter, index) => {
        children.push(
          new Paragraph({
            text: `第 ${index + 1} 章｜${chapter.title || "未命名章节"}`,
            heading: HeadingLevel.HEADING_2,
          })
        );
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: chapter.summary || "",
                italics: true,
                color: "666666",
              }),
            ],
          })
        );
        children.push(new Paragraph({ text: "" }));

        (chapter.content ?? []).forEach((p) => {
          const text = (p ?? "").trim();
          if (!text) return;
          children.push(new Paragraph({ text }));
        });

        children.push(new Paragraph({ text: "" }));
      });
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const fileName = `${safeFileName(bookTitle)}_${dateTag}.docx`;
    const asciiName = `${asciiFileName(safeFileName(bookTitle))}_${dateTag}.docx`;
    const encodedName = encodeURIComponent(fileName);

    return new Response(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
      },
    });
  } catch (error) {
    console.error("docx export error:", error);
    return NextResponse.json(
      { message: "导出失败", error: String(error) },
      { status: 500 }
    );
  }
}
