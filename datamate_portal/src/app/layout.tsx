import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DataMate - Plataforma de Inteligencia Educativa",
  description: "Plataforma de analisis de gastos educativos para la Superintendencia de Educacion de Chile",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-[var(--bg-primary)]">{children}</body>
    </html>
  );
}
