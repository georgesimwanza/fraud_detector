import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Bundled from @fontsource-variable/nunito, not fetched from Google Fonts: the app must
// render with no internet connection (NFR7 — the demo runs on a standalone laptop).
const nunito = localFont({
  src: "../node_modules/@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2",
  weight: "200 1000",
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Fraud Detection",
  description: "Real-time payment fraud detection — live monitoring and alert review",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={nunito.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
