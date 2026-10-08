# FrameCut public website

https://weigenwu.github.io/MOVIE/

This branch contains the built static editor and its local processing engine.
Video files stay in the user's browser.

Source branch: codex/video-crop-studio
Source commit: 009f6f7dd98637f3c35140c21cd9c147515c7e92
Build: npm ci && npm run build
Deployment: GitHub Pages, deploy from codex/pages at / (with .nojekyll).

For updates, build the source locally and publish dist/ to this branch. Keep the
entry URL unchanged. Bump the offline release identifier when changing assets.
The previous Githack branch is retained independently as a fallback.