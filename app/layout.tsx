import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Sprite Sheet Creator',
  description: 'Create pixel art sprite sheets with a VPS Codex Agent',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
