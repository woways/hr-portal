import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-poppins",
});

export const metadata: Metadata = {
  title: "Woways HR Portal",
  description: "Enterprise HR Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable} h-full`} style={{ colorScheme: "light" }}>
      <head>
        {/* Always force light mode — clear any stored dark preference */}
        <script dangerouslySetInnerHTML={{ __html: `try{localStorage.removeItem('theme');document.documentElement.classList.remove('dark')}catch(e){}` }} />
      </head>
      <body className="antialiased min-h-full">{children}</body>
    </html>
  );
}
