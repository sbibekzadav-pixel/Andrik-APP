import { bundledImages } from '../data/assets';

const KNOWN_KEYS = new Set([
  'logo', 'projector', 'ps5Big', 'ps5Small', 'driving', 'stock',
  'campa', 'coke', 'jelly', 'real', 'water', 'xtreme', 'chips',
]);

export function resolveBundledImageKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return KNOWN_KEYS.has(key) ? key : undefined;
}

export function normalizePhotoUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  if (uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('http')) {
    return uri;
  }
  return uri;
}

export function getBundledImage(key: string | undefined): ReturnType<typeof require> | null {
  if (!key) return null;
  return bundledImages[key] ?? null;
}
