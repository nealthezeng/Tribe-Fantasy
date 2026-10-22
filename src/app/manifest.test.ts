import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The installed app (t326): a manifest and icons that resolve under the site path /Tribe-Fantasy/.
const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const text = (path: string) => read(path).toString('utf8');
// A PNG's size is the IHDR width and height at bytes 16 and 20.
const pngSize = (path: string) => {
  const buf = read(path);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};

const loadManifest = () => JSON.parse(text('public/manifest.webmanifest'));

describe('the web app manifest', () => {
  it('describes the installed app under the site path', () => {
    const manifest = loadManifest();
    expect(manifest).toEqual({
      name: 'Tribe Fantasy',
      short_name: 'Tribe Fantasy',
      description: 'Fantasy league for our college ultimate team. Every dollar goes to the team fund.',
      id: './',
      start_url: './',
      scope: './',
      display: 'standalone',
      background_color: '#080b0f',
      theme_color: '#05070a',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    });
    // Relative URLs resolve against the manifest's own URL, so they follow the base path.
    const strings = [manifest.id, manifest.start_url, manifest.scope, ...manifest.icons.map((i: { src: string }) => i.src)];
    for (const s of strings) expect(s.startsWith('/')).toBe(false);
  });

  it('ships each icon at the size the manifest states', () => {
    const manifest = loadManifest();
    for (const icon of manifest.icons as { src: string; sizes: string; purpose?: string }[]) {
      expect(pngSize(`public/${icon.src}`)).toEqual(icon.sizes.split('x').map(Number));
      if (icon.purpose === 'maskable') expect(icon.src).toBe('icon-512.png');
    }
    expect(pngSize('public/apple-touch-icon.png')).toEqual([180, 180]);
  });
});

describe('index.html', () => {
  it('links the manifest and the iPhone icon through the base path', () => {
    const html = text('index.html');
    expect(html).toContain('<link rel="manifest" href="%BASE_URL%manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="%BASE_URL%apple-touch-icon.png" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black" />');
  });
});
