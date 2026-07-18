import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "落卷",
  description: "面向中老年用户的 AI 回忆录应用",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
