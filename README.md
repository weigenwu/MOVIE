# FrameCut static release

2026-10-07 automatic scale update: each input detects a unique original line and nearby label at either bottom corner, using the user's stated 50 µm reference and the measured source-pixel width for calibration. Missing or ambiguous references require retry or manual measurement; image resolution alone is never a physical calibration. Set the actual reference value if an input is not labeled 50 µm.

Scale text is bold and the line is approximately twice as thick, without changing its calibrated horizontal length. Automatic matching chooses a fitting positive integer from 1, 2, 5, 10, 20, 50… near a quarter of the crop width. Editing the length switches to manual mode and preserves that setting when cropping; the automatic checkbox restores matching. A tiny crop that cannot fit an integer scale reports an error rather than drawing a falsely shortened line.

Validation: 48 synthetic AVI/MP4 source frames locate the 200px=50µm reference at both bottom corners, including decoded downsample mapping. Four actual WASM exports use automatic 5/10/20µm and manual 15µm scales with 20/40/80/60px lines. Independent decoding verifies changing source timestamps and scale geometry; FFV1 pixels outside annotations are exact and MP4 is assessed as lossy. Application tests cover source ownership, manual-setting persistence and physical-unit conversion through px without losing the reference unit. Real browser interaction and the user's original large video remain unverified.

2026-10-07 appearance update: timestamp width defaults to 40% of the cropped output, adjustable from 15–90% by slider or number. Preview and export share layout; Lanczos smooths the exported stamp. New default transparent backgrounds extract the changing original timestamp glyphs as red text, and draw the calibrated scale as a white line plus outlined text without a rectangular backdrop. Uncheck Transparent background to retain the black boxes. All settings remain per input file.

An original timestamp already included within the crop keeps its native pixels: size and position controls are disabled with an explanation. Crop the original label out of the scientific field before resizing or removing the copied strip's background. The tool never reconstructs pixels hidden under a burned-in source label. The calibrated scale line length is unchanged by styling.

This red-glyph release passes timestamp, scale and application/export regression tests plus four actual bundled-WASM cases independently decoded with native FFmpeg: 25% transparent red AVI, 40% transparent red MP4, opaque red AVI, and an unchanged full original timestamp. Each six-frame trim matches source frames 3–8. FFV1 preserves pixels outside annotations; transparent glyph blending has small rounding differences. MP4 is assessed as lossy. The calibrated white line geometry remains 100px. Real browser UI and the user's original large AVI were not tested; no user photographs or QA videos are published.

2026-10-07: automatically locate the original top-right timestamp strip when importing a video. Copy its pixels from each source frame into the cropped output, default top-right; retain the original experiment-time format and values, never infer them from playback seconds. The user no longer needs to draw a timestamp region. The main viewer remains the scientific crop tool.

Detection looks for a compact row of light-neutral characters on a dark background near the top-right. Missing or invalid detections block time-preserving export, with a retry on another frame. There is no large-scene fallback. Per-file regions survive crop/zoom changes, failed retries and file switching. The extracted strip and final composition are previewed beside Export. Calibrated custom scale bars default to bottom-right.

Unit and application-state tests cover faint/noisy labels, scene rejection, original-coordinate mapping, decoded AVI frames, native MP4 readiness, stale-source guards, preserved crop state, frame-pixel previews and AVI/MP4 export arguments. Actual browser UI and the user's original large AVI are unavailable for this validation round. User screenshots and generated QA videos are not published.

Four actual bundled-WASM export cases passed independent native FFmpeg decoding: AVI to FFV1, AVI to MP4, MP4 to MP4, and full-frame output where the original timestamp already survives. Six trimmed frames each retain their corresponding experiment clocks, including changing .111/.888 glyph widths. FFV1 composites are byte-exact and all scale bars measure 100px. A timestamp already fully included in a top-right crop is copied in place, avoiding duplicate offset characters. Fixtures are synthetic.

Stable latest entry: https://raw.githack.com/weigenwu/MOVIE/codex/static-site/index.html

Future updates use this same branch URL. According to https://raw.githack.com/ the branch endpoint refreshes within minutes after a push; high-traffic caching may extend to an hour. Reload an already open editor after the update. Existing commit-pinned `rawcdn.githack.com` links keep their original versions. This free third-party service has no guaranteed uptime or availability on every network.

Validated using this exact WASM engine as a compute library: six AVI/MP4 export cases cover both corners, scaling, nonzero trim starts, disabled overlay, and audio retention. Native FFmpeg independently decoded every output; FFV1 RGB frames matched the expected composite byte-for-byte. Browser UI verification was unavailable in this session.

A browser-local AVI/MP4 crop and trim editor. This branch contains only the prebuilt website and video processing engine. Video inputs and exported results stay on the visitor's device.

Source: https://github.com/weigenwu/MOVIE/tree/a7bd92358d24e1931ddaeae10cd494ca258c29a6

This branch has no GitHub Actions workflow. The fixed HTML entry pins its stylesheet, FFmpeg wrapper and app module to the same immutable asset commit on raw.githack.com. Their relative imports and workers stay on that revision, so an older cached entry cannot mix with newer scripts. For each update: synchronize and commit the runtime files first; then set the three HTML asset URLs to that commit and push the branch. Verify the fixed entry and all pinned resources. Keep user bookmarks unchanged. For deployment on another static host, use the source HTML's relative asset paths.

Third-party components: @ffmpeg/ffmpeg 0.12.15 (MIT) and @ffmpeg/core 0.12.10 (GPL-2.0-or-later). Source and build instructions: https://github.com/ffmpegwasm/ffmpeg.wasm and https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10 .

CDN adaptations: the two WebAssembly segments use `.wasm` names so raw.githack.com serves them directly. On the shared githack.com origin, directory handles are kept only in the current page and never persisted to IndexedDB; repeated exports in that page still use the chosen folder. A dedicated hosting origin retains the original persistent-folder behavior.

Run `node verify-release.mjs` to check release engine integrity and shared-origin directory handling.

2026-09-23: All four crop corners now have larger handles and zoom-independent hit targets, including the portion outside video edges. Hover shows the resize direction. Run `node test-crop-handles.mjs` for the edge/zoom regression check. Browser checks covered all four corners at 1x and 3x, 1:1 aspect lock, and MP4 export.

2026-10-05: Simplified labels and spacing, moved repeated instructions into Help, and retained actionable errors and folder-saving status. Browser validation covered a synthetic 320x320 AVI, zoom, crop/time settings, and a 240x240 one-second MP4 export. Existing crop-handle and release-integrity checks pass.

2026-10-06: Dragging the video now always starts a new selection by default, including inside an existing crop; no selection-mode button is required. Handles still resize the crop, and the optional Move selection button (移动选框) enables dragging the existing region without resizing. Escape returns to direct selection. Square crops expose a pixel side-length input; rectangles retain width/height fields. Browser checks covered consecutive forward/reverse selections with no toolbar clicks, click-without-drag, corner resizing, explicit movement, Escape, square side length, and a 160x160 MP4 export from a synthetic AVI. No source video or test output is included in this release.
