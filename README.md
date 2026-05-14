# RadioDock

Internet radio in your browser, or installed as an app on your home screen.

Live: **<https://radiodock.app>**

This is the PWA rebuild of the [RadioDock Chrome extension](https://github.com/bitm4ncer/RadioDock).

## Local dev

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
npm run preview  # serve dist/ locally
```

Node 22+ recommended (`.nvmrc` provided).

## Deployment

Push to `main` → GitHub Actions builds and publishes to GitHub Pages. Custom domain `radiodock.app` is configured via `public/CNAME` and the DNS records below.

### DNS records (one-time setup at the domain registrar)

Point the apex `radiodock.app` to GitHub Pages by adding **A records** to all four GitHub IPs:

```
A    @    185.199.108.153
A    @    185.199.109.153
A    @    185.199.110.153
A    @    185.199.111.153
AAAA @    2606:50c0:8000::153
AAAA @    2606:50c0:8001::153
AAAA @    2606:50c0:8002::153
AAAA @    2606:50c0:8003::153
```

(Optionally also `CNAME www radiodock.app` if you want `www.` to redirect.)

After DNS propagates, in the GitHub repo: **Settings → Pages → Custom domain** = `radiodock.app`, then check **Enforce HTTPS** once the cert provisions.

## Project structure

See [ROADMAP.md](./ROADMAP.md) for milestones and [`docs/`](./docs) for technical notes once those land.

## Credit

Built on top of the [RadioDock metadata proxy](https://github.com/bitm4ncer/RadioDock-metadata-proxy) and the [Radio Browser API](https://www.radio-browser.info/).
