import "./globals.css";
import { Providers } from "./Providers";

export const metadata = { title: "Navy Wallet", description: "Your wallet for the open ocean." };

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
