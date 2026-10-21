import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") || incoming.get("host") || "localhost:3001";
  const protocol =
    incoming.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const socialImage = `${origin}/og.png`;
  return {
    title: "环真｜牛顿环数据还原工具",
    description:
      "分析牛顿环照片中的形状，处理用户输入的实测数据，基于物理模型提供条件性的曲率估计。",
    openGraph: {
      title: "环真｜从环纹出发，还原实验数据",
      description: "面向高校物理实验的牛顿环图像判断、复合还原与报告输出工具。",
      type: "website",
      url: origin,
      images: [{ url: socialImage, width: 1730, height: 909, alt: "环真牛顿环数据还原工具" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "环真｜牛顿环数据还原工具",
      description: "判断圆或椭圆，复合还原实验数据。",
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
