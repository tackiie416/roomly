import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roomly",
  description: "Encuentra piso. Encuentra compañeros. Encaja de verdad.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="antialiased">
        <Nav />
        {children}
      </body>
    </html>
  );
}
