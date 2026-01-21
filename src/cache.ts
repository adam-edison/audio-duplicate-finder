import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { Cache, CacheEntry } from './types.js';

const CACHE_DIR = join(homedir(), '.mp3-metadata');
const CACHE_FILE = join(CACHE_DIR, 'cache.json');
const MAX_RECENT = 20;

function createEmptyCache(): Cache {
  return {
    entries: {},
    recentGenres: [],
    recentArtists: [],
    recentDirectories: [],
  };
}

export async function loadCache(): Promise<Cache> {
  try {
    const data = await readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(data) as Cache;
  } catch {
    return createEmptyCache();
  }
}

export async function saveCache(cache: Cache): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function normalizeKey(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getCachedEntry(cache: Cache, filename: string): CacheEntry | null {
  const key = normalizeKey(filename);
  return cache.entries[key] ?? null;
}

export function setCacheEntry(
  cache: Cache,
  filename: string,
  entry: Omit<CacheEntry, 'usedAt'>
): void {
  const key = normalizeKey(filename);

  cache.entries[key] = {
    ...entry,
    usedAt: Date.now(),
  };

  if (entry.genre && !cache.recentGenres.includes(entry.genre)) {
    cache.recentGenres.unshift(entry.genre);
    cache.recentGenres = cache.recentGenres.slice(0, MAX_RECENT);
  }

  if (entry.artist && !cache.recentArtists.includes(entry.artist)) {
    cache.recentArtists.unshift(entry.artist);
    cache.recentArtists = cache.recentArtists.slice(0, MAX_RECENT);
  }
}

export function getRecentArtists(cache: Cache): string[] {
  return cache.recentArtists;
}

export function getRecentGenres(cache: Cache): string[] {
  return cache.recentGenres;
}

export function getRecentDirectories(cache: Cache): string[] {
  return cache.recentDirectories ?? [];
}

export function addRecentDirectory(cache: Cache, dir: string): void {
  if (!cache.recentDirectories) {
    cache.recentDirectories = [];
  }

  const index = cache.recentDirectories.indexOf(dir);

  if (index !== -1) {
    cache.recentDirectories.splice(index, 1);
  }

  cache.recentDirectories.unshift(dir);
  cache.recentDirectories = cache.recentDirectories.slice(0, 10);
}
