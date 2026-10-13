# Vendored PDF.js

Version: 5.4.624 (stable 5.x legacy build, tested with Chromium 130; manifest minimum Chrome 120 has not been directly tested).
License: Apache-2.0; codec licenses retained under wasm/.
Source: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-5.4.624.tgz
Upstream: https://github.com/mozilla/pdf.js/releases/tag/v5.4.624
Tarball SHA-256: 5c387457cd03cc2e7b9c9b1ed642e8148d1ba44c3b8e5b5b771526feb24b61b9
Verified npm SHA-512 integrity: sha512-sm6TxKTtWv1Oh6n3C6J6a8odejb5uO4A4zo/2dgkHuC0iu8ZMAXOezEODkVaoVp8nX1Xzr+0WxFJJmUr45hQzg==

Retained bytes: 2541241 (before ZIP compression). Legacy display/worker minified modules (upstream browser compatibility polyfills for the manifest minimum Chrome 120 and Chromium 130) and local image/color codecs only. No upstream viewer, source maps, Node build, samples or editor assets. The two .mjs files are renamed to .js for the current release asset allowlist. No CDN execution. isEvalSupported is disabled. Packed CMaps and non-embedded standard-font data are omitted; those unusual documents may need a future full-data build.

VENDOR.txt is an identical distributable copy because the existing packager does not include generic vendor Markdown.

## SHA-256 of retained upstream files

246b088f414359637e6403753a1e815caa4bd20e9c645be4b5ef4c89f405aafa  pdf.min.js (481423 bytes; upstream legacy/build/pdf.min.mjs)
88b29a656ecf0b104c2ef1b620be099c523be2a57f27fbb8a42bdac6b8c9a4c0  pdf.worker.min.js (1128591 bytes; upstream legacy/build/pdf.worker.min.mjs)
0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594  LICENSE.txt (10174 bytes; upstream LICENSE)
67b8e2b162da472e98cb48d3d32e3e38fff481b9b32ff4818e78bb248af88ab2  wasm/openjpeg.wasm (250009 bytes; upstream wasm/openjpeg.wasm)
6017eca5939cde1836e88e6d8cd27ae039246f206515ea4487bdfd0e3fb16e26  wasm/qcms_bg.wasm (94519 bytes; upstream wasm/qcms_bg.wasm)
df85117444f0f0150c5c9d0dd8eeab102d705217f838a9f6d46788b6d9b3d681  wasm/jbig2.wasm (105557 bytes; upstream wasm/jbig2.wasm)
07c3c3361827308741bc31c561b59e705ebb4d1e8efb84e4d24884e230dbb894  wasm/openjpeg_nowasm_fallback.js (451777 bytes; upstream wasm/openjpeg_nowasm_fallback.js)
9e66b7f1b934a28b37f3bc4dac97915de1674271e79a0a88182a18ed9731b4d1  wasm/LICENSE_JBIG2.txt (12862 bytes; upstream wasm/LICENSE_JBIG2)
a6af136f3e15038a666b61f376612a07d9a4e48cb7c01adbf3e33b3f14ab49b6  wasm/LICENSE_OPENJPEG.txt (2112 bytes; upstream wasm/LICENSE_OPENJPEG)
aad3cce09842e00e9e11ad5e8fef8cc02fbc3a3768fe2f007443b9cee37aaee5  wasm/LICENSE_PDFJS_JBIG2.txt (555 bytes; upstream wasm/LICENSE_PDFJS_JBIG2)
717fc62da03292dbb4dd0c8280bd4ce7bb8550dcf31d772bc93455fb50313425  wasm/LICENSE_PDFJS_OPENJPEG.txt (1285 bytes; upstream wasm/LICENSE_PDFJS_OPENJPEG)
eb5104ca33552be007857a28351bc408f379ddd4bfacab1226b09c6d1e9fd7c4  wasm/LICENSE_PDFJS_QCMS.txt (1285 bytes; upstream wasm/LICENSE_PDFJS_QCMS)
36d847ae882f6574ebc72f56a4f354e4f104fde4a584373496482e97d52d31bc  wasm/LICENSE_QCMS.txt (1121 bytes; upstream wasm/LICENSE_QCMS)

## Local hardening patch

In pdf.min.js, the unused _createCDNWrapper function is replaced with a throw requiring a bundled same-origin worker. This disables creation of an executable blob for cross-origin worker URLs and avoids the existing static import scanner misreading the upstream string template. The upstream SHA-256 above is the pre-patch hash. All other upstream files remain byte-identical.
Installed pdf.min.js SHA-256: e6c663a51783709481c571e942f77de88a0fcdb89e078ce1ed4137998b143d9a
