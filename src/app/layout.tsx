import type { Metadata } from "next";
import { DotGothic16 } from "next/font/google";
import { AppShell } from "@/components/ps1/app-shell";
import { Ps1PrefsProvider } from "@/components/ps1/ps1-prefs";
import "./globals.css";

const dotGothic = DotGothic16({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-dotgothic",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Idea Brewing",
  description: "アイデアを醸造してサービスに仕上げるローカル醸造所",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className={dotGothic.variable}>
      <body className={dotGothic.className}>
        <Ps1PrefsProvider>
          <AppShell>{children}</AppShell>
        </Ps1PrefsProvider>
      </body>
    </html>
  );
}
