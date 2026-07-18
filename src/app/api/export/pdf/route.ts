import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
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

async function renderPdfBuffer(input: {
  title: string;
  dateTag: string;
  chapters: Array<{ title: string; summary: string; content: string[] }>;
  draft?: { title: string; content: string };
}) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 54,
    info: {
      Title: input.title,
      Author: "落卷",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk as Buffer));

  doc.fontSize(22).text(input.title, { align: "left" });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#666666").text(`导出日期：${input.dateTag}`);
  doc.moveDown(1.2);
  doc.fillColor("#222222");

  if (input.chapters.length === 0) {
    doc.fontSize(14).text("（当前还没有收录章节）");
    doc.moveDown(0.7);
    if (input.draft?.content?.trim()) {
      doc.fontSize(13).text(input.draft.title || "未收录草稿");
      doc.moveDown(0.5);
      doc.fontSize(12).text(input.draft.content.trim(), {
        lineGap: 4,
      });
    }
  } else {
    input.chapters.forEach((chapter, index) => {
      doc.fontSize(14).text(`第 ${index + 1} 章｜${chapter.title || "未命名章节"}`);
      if (chapter.summary) {
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor("#666666").text(chapter.summary, {
          lineGap: 3,
        });
        doc.fillColor("#222222");
      }
      doc.moveDown(0.6);
      chapter.content.forEach((p) => {
        const text = (p ?? "").trim();
        if (!text) return;
        doc.fontSize(12).text(text, { lineGap: 4 });
        doc.moveDown(0.6);
      });
      doc.addPage();
    });
  }

  doc.end();

  await new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", (err) => reject(err));
  });

  return Buffer.concat(chunks);
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

    const buffer = await renderPdfBuffer({
      title: bookTitle,
      dateTag,
      chapters: state.chapters.map((chapter) => ({
        title: chapter.title || "",
        summary: chapter.summary || "",
        content: chapter.content ?? [],
      })),
      draft: state.draft?.content?.trim()
        ? { title: state.draft.title || "未收录草稿", content: state.draft.content }
        : undefined,
    });

    const fileName = `${safeFileName(bookTitle)}_${dateTag}.pdf`;

    return new Response(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("pdf export error:", error);
    return NextResponse.json(
      { message: "导出失败", error: String(error) },
      { status: 500 }
    );
  }
}
