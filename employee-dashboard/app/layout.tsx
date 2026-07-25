import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HR Pulse - Employee Portal",
  description: "Employee Self-Service Portal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.className} h-full antialiased`} style={{ colorScheme: "light" }}>
      <head>
        {/* Always force light mode — clear any stored dark preference */}
        <script dangerouslySetInnerHTML={{ __html: `try{localStorage.removeItem('theme');document.documentElement.classList.remove('dark')}catch(e){}` }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
