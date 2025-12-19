import "./globals.css";

import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Object/Pose Detection",
  description: "Async object and pose detection"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen">
          <header className="border-b border-white/10">
            <div className="mx-auto max-w-6xl px-4 py-8 text-center">
              <div className="text-3xl font-semibold tracking-tight">Object/Pose Detection</div>
              <div className="mt-2 text-base text-white/70">Upload an image, and run object or pose detection</div>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
