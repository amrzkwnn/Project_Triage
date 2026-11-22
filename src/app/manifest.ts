export type WebAppManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose?: 'any' | 'maskable' | 'monochrome' | 'badge';
};

export type WebAppManifest = {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  display: 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser';
  background_color: string;
  theme_color: string;
  icons: WebAppManifestIcon[];
};

export function manifest(): WebAppManifest {
  return {
    name: 'Triage',
    short_name: 'Triage',
    description:
      'A calm, safe digital helper for messages, photos, scam checks, and calendar.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FAF9F6',
    theme_color: '#0F766E',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}

export default manifest;
