# technical-chaos.github.io

Source for <https://technical-chaos.github.io>, built with
[Starlight](https://starlight.astro.build) (Astro).

```bash
npm ci
npm run dev       # local preview at http://localhost:4321
npm run build     # production build into dist/, fails on broken internal links
```

Pages live in `src/content/docs/`; each folder becomes a sidebar group. Every
pull request is built by `.github/workflows/deploy.yml`; pushes to `main` are
deployed to GitHub Pages.

Everything here is public: use example hosts, addresses and names, never real
ones or secrets.
