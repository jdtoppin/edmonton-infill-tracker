import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const baseUrl = host
    ? new URL(`${protocol}://${host}`)
    : new URL(process.env.APP_URL ?? "http://localhost:3000");

  return {
    metadataBase: baseUrl,
    title: {
      default: "Edmonton Infill Tracker",
      template: "%s · Edmonton Infill Tracker",
    },
    description:
      "Track Edmonton permit activity and find likely residential infill projects earlier.",
    applicationName: "Edmonton Infill Tracker",
    openGraph: {
      type: "website",
      siteName: "Edmonton Infill Tracker",
      title: "Edmonton Infill Tracker",
      description:
        "Permit signals, project timelines, and neighbourhood alerts for Edmonton infill.",
      images: [{ url: new URL("/og.png", baseUrl).toString(), width: 1536, height: 1024 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Edmonton Infill Tracker",
      description: "See Edmonton infill signals before the listing appears.",
      images: [new URL("/og.png", baseUrl).toString()],
    },
    robots: { index: false, follow: false },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
