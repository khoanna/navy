import "./globals.css";

export const metadata = { title: "Navy Wallet", description: "Your wallet for the open ocean." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
