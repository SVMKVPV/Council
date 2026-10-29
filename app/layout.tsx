import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Council — four models, one build",
  description:
    "Bring Claude, ChatGPT, Gemini, and Llama into one structured product council.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
