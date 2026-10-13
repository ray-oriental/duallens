# Upstream OCR runtime

Tesseract.js 5.1.1 and tesseract.js-core 5.1.1, Apache-2.0, downloaded from npm without modifications. Reference files were only hashed, never inspected.

- `tesseract.min.js`: SHA-256 `a8e29918d098b2b06e1012bdaeffb4aec0445c5d5654709023e0bd1f442a80e8`; reference same-name match: False; source https://registry.npmjs.org/tesseract.js/-/tesseract.js-5.1.1.tgz (`package/dist/tesseract.min.js`).
- `worker.min.js`: SHA-256 `aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc`; reference same-name match: True; source https://registry.npmjs.org/tesseract.js/-/tesseract.js-5.1.1.tgz (`package/dist/worker.min.js`).
- `tesseract.js-LICENSE.txt`: SHA-256 `b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1`; reference same-name match: not present; source https://registry.npmjs.org/tesseract.js/-/tesseract.js-5.1.1.tgz (`package/LICENSE.md`).
- `tesseract.min.js.LICENSE.txt`: SHA-256 `cdf963ced7d25a0f98901a547647b4d6e2dbe0197fd78c87a059a87b0e542fe2`; reference same-name match: not present; source https://registry.npmjs.org/tesseract.js/-/tesseract.js-5.1.1.tgz (`package/dist/tesseract.min.js.LICENSE.txt`).
- `worker.min.js.LICENSE.txt`: SHA-256 `45f54171aeaa1d10c0c1a66f374b7bba1f02472b1487fbe892eec04f840002ac`; reference same-name match: not present; source https://registry.npmjs.org/tesseract.js/-/tesseract.js-5.1.1.tgz (`package/dist/worker.min.js.LICENSE.txt`).
- `tesseract-core-simd-lstm.wasm`: SHA-256 `66b601224a0c4a8977bc9d92dd39841189f9ca22cc4122fcd7208cdb0961eeef`; reference same-name match: True; source https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-5.1.1.tgz (`package/tesseract-core-simd-lstm.wasm`).
- `tesseract.js-core-LICENSE.txt`: SHA-256 `c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08`; reference same-name match: not present; source https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-5.1.1.tgz (`package/LICENSE`).

Language data: tessdata_fast commit 87416418657359cb625c412a48b6e1d6d41c29bd, Apache-2.0. Not packaged. Fixed URLs and SHA-256 in offscreen/languages.json. Source/license: https://github.com/tesseract-ocr/tessdata_fast .

- `tesseract-core-simd-lstm.js`: SHA-256 `4135a3f6f1cccf3bc92058c1273c49bb4cff6356e1ba15d1b8b4e76e9890526b`; reference same-name match: True; source https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-5.1.1.tgz (`package/tesseract-core-simd-lstm.js`).

Desktop extension loads only the ordinary core JS plus the independent WASM. The embedded-WASM JS and generated source string container have been removed from the repository and release.

Userscript resources (not packaged or inlined into duallens.user.js):
- `duallensOcrCore`: https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm.js ; SHA-256 `ce20eda9533cbed1e6c2b4276fbae1e0adc61b6754b5513084be601787b457cf`; 3938657 bytes. Same-name reference comparison made in initial audit: False; never substituted with reference content.
- `duallensOcrWorker`: https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js ; SHA-256 `aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc`; 123724 bytes. Same-name reference match: True.

Tampermonkey metadata pins each resource with `#sha256=`; the lazy loader independently checks size and SHA-256 before creating a Worker. No resource is read or parsed on ordinary page startup. Unsupported resource APIs use an anonymous GM request to these same fixed URLs, verify the bytes, and cache in private GM storage. Runtime resources never use webpage storage. Apache-2.0 and bundled dependency notices above also apply to the resources.

Live fixed jsDelivr GET verification on 2026-10-13 confirmed both resource byte counts and full SHA-256 above match the unmodified npm files.
