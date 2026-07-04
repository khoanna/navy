import "./globals.css";
import type { Viewport } from "next";
import { Providers } from "./Providers";

export const metadata = { title: "Navy Wallet", description: "Your wallet for the open ocean." };

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#060B17",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="navy-frame">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
