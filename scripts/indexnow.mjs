// Submit every URL in the sitemap to IndexNow after a Pages deploy.
//
// IndexNow is the current way to tell Bing (and the other participating
// engines) that URLs changed; the old sitemap ping endpoint is retired. The
// key file lives in public/ and is served from the site root, which is what
// proves ownership. The workflow step is continue-on-error: a search-engine
// hiccup must never turn a successful deploy red.

import { readFile, readdir } from 'node:fs/promises';

const HOST = 'radiodock.app';
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const publicDir = new URL('../public/', import.meta.url);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const keyFile = (await readdir(publicDir)).find((name) => /^[a-f0-9]{32}\.txt$/.test(name));
if (!keyFile) throw new Error('No IndexNow key file found in public/');
const key = (await readFile(new URL(keyFile, publicDir), 'utf8')).trim();
if (key !== keyFile.slice(0, -4)) {
  throw new Error(`IndexNow key file ${keyFile} does not contain its own name`);
}

const sitemap = await readFile(new URL('sitemap.xml', publicDir), 'utf8');
const urls = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
  .map((match) => match[1].replace(/&amp;/g, '&'));
if (!urls.length) throw new Error('Sitemap contains no URLs');

const keyLocation = `https://${HOST}/${keyFile}`;

// The deploy job can finish before the CDN serves the new key file. Give it a
// short, bounded window instead of failing the run on the first 404.
for (let attempt = 1; attempt <= 10; attempt++) {
  const res = await fetch(keyLocation, { cache: 'no-store' });
  if (res.ok && (await res.text()).trim() === key) break;
  if (attempt === 10) throw new Error(`IndexNow key not reachable at ${keyLocation}`);
  await sleep(5_000);
}

// IndexNow accepts at most 10,000 URLs per request.
for (let i = 0; i < urls.length; i += 10_000) {
  const body = {
    host: HOST,
    key,
    keyLocation,
    urlList: urls.slice(i, i + 10_000),
  };
  const res = await fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  console.log(`IndexNow ${res.status} ${res.statusText} — ${body.urlList.length} URL(s)`);
  if (!res.ok && res.status !== 202) {
    throw new Error(`IndexNow rejected the submission: HTTP ${res.status}`);
  }
}
