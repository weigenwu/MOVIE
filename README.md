# FrameCut static release

A browser-local AVI/MP4 crop and trim editor. This branch contains only the prebuilt website and video processing engine. Video inputs and exported results stay on the visitor's device.

Source: https://github.com/weigenwu/MOVIE/tree/2ebdbc7d5e55a32ed783007495aa8c432d0305cd

This branch has no GitHub Actions workflow. It can be served by any HTTPS static host, or through raw.githack.com using an immutable commit URL.

Third-party components: @ffmpeg/ffmpeg 0.12.15 (MIT) and @ffmpeg/core 0.12.10 (GPL-2.0-or-later). Source and build instructions: https://github.com/ffmpegwasm/ffmpeg.wasm and https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10 .

CDN adaptations: the two WebAssembly segments use `.wasm` names so raw.githack.com serves them directly. On the shared githack.com origin, directory handles are kept only in the current page and never persisted to IndexedDB; repeated exports in that page still use the chosen folder. A dedicated hosting origin retains the original persistent-folder behavior.

Run `node verify-release.mjs` to check release engine integrity and shared-origin directory handling.

2026-09-23: All four crop corners now have larger handles and zoom-independent hit targets, including the portion outside video edges. Hover shows the resize direction. Run `node test-crop-handles.mjs` for the edge/zoom regression check. Browser checks covered all four corners at 1x and 3x, 1:1 aspect lock, and MP4 export.

2026-10-05: Simplified labels and spacing, moved repeated instructions into Help, and retained actionable errors and folder-saving status. Browser validation covered a synthetic 320x320 AVI, zoom, crop/time settings, and a 240x240 one-second MP4 export. Existing crop-handle and release-integrity checks pass.

2026-10-06: New videos start in draw-selection mode. The Frame selection button (框选) lets users draw a new crop anywhere, then returns to move/resize mode. Square crops expose one pixel side-length input; rectangles retain independent width/height fields. Browser checks covered click-without-drag, forward/reverse drawing within an existing crop, movement, 3x zoom, 1:1 locking, size limits, corner resizing, pan/Escape mode switching, and a 160x160 MP4 export from a synthetic AVI. No source video or test output is included in this release.
