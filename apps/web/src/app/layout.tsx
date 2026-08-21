import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Trip Music", description: "6/18 field trip collaborative music queue" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="th"><body>{children}</body></html>; }
