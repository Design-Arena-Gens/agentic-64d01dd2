import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Cinematic 3D Generator',
  description: 'Ultra-realistic, featureless humanoid visuals for documentaries and b-roll.'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
