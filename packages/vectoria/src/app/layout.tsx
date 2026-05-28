import type { Metadata } from "next";
import "./globals.css";
import { FlaxiaNodeProvider } from "@/components/FlaxiaNodeProvider";

export const metadata: Metadata = {
  title: "Vectoria Search",
  description: "Decentralized vector search engine powered by Flaxia Crowd",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('vectoria-theme');
                  if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-white dark:bg-[#202124]">
        <FlaxiaNodeProvider>{children}</FlaxiaNodeProvider>
      </body>
    </html>
  );
}
