import type { Metadata } from "next";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Smart Wishlist",
  description: "Track prices, get alerts, buy at the right time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}