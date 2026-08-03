import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const configuredUrl = process.env.APP_URL;
  let baseUrl: URL | null = null;
  if (configuredUrl) {
    try {
      const candidate = new URL(configuredUrl);
      if (candidate.protocol === "http:" || candidate.protocol === "https:") baseUrl = candidate;
    } catch {
      // Invalid configuration falls through to a tightly validated request host.
    }
  }
  const host = requestHeaders.get("host");
  const protocolHeader = requestHeaders.get("x-forwarded-proto");
  const protocol = protocolHeader === "https" ? "https" : "http";
  if (!baseUrl && host && /^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(host)) {
    baseUrl = new URL(`${protocol}://${host}`);
  }
  baseUrl ??= new URL("http://localhost:3000");

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
      images: [
        { url: new URL("/og-map-projects.png", baseUrl).toString(), width: 1200, height: 630 },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Edmonton Infill Tracker",
      description: "See Edmonton infill signals before the listing appears.",
      images: [new URL("/og-map-projects.png", baseUrl).toString()],
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
