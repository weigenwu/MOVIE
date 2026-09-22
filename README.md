# FrameCut static release

A browser-local AVI/MP4 crop and trim editor. This branch contains only the prebuilt website and video processing engine. Video inputs and exported results stay on the visitor's device.

Source: https://github.com/weigenwu/MOVIE/tree/09211501e7bb7fe259cde5ef855924f8a9e80965

This branch has no GitHub Actions workflow. It can be served by any HTTPS static host, or through raw.githack.com using an immutable commit URL.

Third-party components: @ffmpeg/ffmpeg 0.12.15 (MIT) and @ffmpeg/core 0.12.10 (GPL-2.0-or-later). Source and build instructions: https://github.com/ffmpegwasm/ffmpeg.wasm and https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10 .

CDN adaptations: the two WebAssembly segments use `.wasm` names so raw.githack.com serves them directly. On the shared githack.com origin, directory handles are kept only in the current page and never persisted to IndexedDB; repeated exports in that page still use the chosen folder. A dedicated hosting origin retains the original persistent-folder behavior.

Run `node verify-release.mjs` to check release engine integrity and shared-origin directory handling.
