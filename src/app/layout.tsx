import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Idea Brewing",
  description: "アイデアを醸造してサービスに仕上げるローカル醸造所",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="antialiased">
        <header className="border-b border-amber-900/50 bg-black/30">
          <nav className="mx-auto flex max-w-5xl items-center justify-between p-4">
            <Link href="/" className="text-xl font-black tracking-wide text-amber-400">
              Idea Brewing
            </Link>
            <Link href="/settings" className="text-amber-200 hover:text-amber-400">
              設定
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
