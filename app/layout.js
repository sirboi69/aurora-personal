export const metadata = {
  title: "Aurora — Gran Box",
  description: "Personal trading desk — Gran Box strategy scanner",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ro">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ margin: 0, background: "#0A0B0D" }}>{children}</body>
    </html>
  );
}
