/**
 * @file app/layout.tsx
 * @description Root layout for T730 locker kiosk application
 */

import './globals.css';

export const metadata = {
  title: 'Coffee Oasis Locker',
  description: 'Smart locker pickup system',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
