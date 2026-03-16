import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Premier Lending Portal",
  description: "Encompass Loan Data Portal for Premier Lending",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--bg-primary)]">{children}</body>
    </html>
  );
}
