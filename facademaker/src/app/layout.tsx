import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Facademaker",
  description: "Design parametric streets and building façades",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body className="h-screen flex flex-col">{children}</body>
    </html>
  );
}
