# 美术源文件

这里保存可追溯的原始素材。游戏只读取 `public/assets` 下由构建脚本生成的运行时文件。

- `catalog.json` 是唯一资产清单，登记来源、许可、输出位置、Web URL、体积预算和场景变换。
- `vendor/` 保存未经修改的第三方文件及其原始许可。
- 自制源文件放入 `source/`，按模型、纹理、动画和着色器分类。
- 不把 Blender、Substance 等工具的缓存和临时导出提交到仓库。

修改源素材后运行 `npm run assets:build`，随后运行 `npm run assets:validate`。生产构建会自动校验运行时资产。
