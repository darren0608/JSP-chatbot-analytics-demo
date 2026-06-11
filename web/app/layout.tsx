import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JSP Assistant",
  description: "A guide to jobs, skills, careers, and training",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
