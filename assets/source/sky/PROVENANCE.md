# 银河贴图

- 来源：OpenAI 内置 image_gen 生图，2026-09-08，生成模式，无输入图片。
- 原始文件：`assets/source/sky/milky-way.png`；运行时：`public/assets/textures/milky-way.webp`。
- AI 生成素材，不标记为第三方 CC0 摄影作品。此图为艺术化星空，不用于天文定位。
- WebP quality 92；使用 npm run assets:build 重建。
- 天空着色器将星带映射为带边缘淡出的天区，夜间显示；不作为严格无缝全天球星图。

## 完整提示词

Use case: photorealistic-natural. Asset type: production night-sky texture for a WebGL sailing game, NOT a screenshot or mockup. Generate a 2:1 wide equirectangular celestial panorama, sky ONLY. A clearly recognizable photographic Milky Way spans diagonally across the central portion from upper left toward lower right: intricate silver-blue star clouds, branching dark interstellar dust lanes, clustered bright galactic core with subtle muted lavender, very many tiny resolved stars with dramatically varied densities and a few moderately bright stars. Rich very dark navy background with generous sparse star regions away from the band. Natural astronomical photography aesthetic, detailed and crisp, no painterly nebula blobs. No terrestrial clouds, no land, no horizon line, no ocean, no moon, no sun, no buildings, no ships, no UI, no labels, no text, no border, no lens flare, no giant stars. Left/right panorama edges should match approximately and remain dark; top and bottom poles very dark with sparse stars. This is the actual reusable sky asset to map onto a sphere. Save the generated image and return its file path.
