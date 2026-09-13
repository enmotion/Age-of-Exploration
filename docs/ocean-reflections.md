# Ocean reflection and celestial highlights

The active ocean material combines three distinct contributions:

- A half-resolution `MirrorTexture` captures the vessel, islands and geometric clouds. Water, wake overlays, sky dome and celestial discs are excluded to avoid recursion and duplicated celestial highlights. Transparent capture pixels fall back to the procedural sky. The reflected view-projection matrix is copied during the mirror pass, rather than retaining the mutable scene matrix.
- Sky and water share cloud generation, daylight colours and time. The sky reflection excludes the solar disc; direct solar specular supplies that energy once. Fresnel controls angle-dependent visibility. Bounded normal distortion and a five-tap roughness filter soften the scene capture, with sky fallback at its screen edges.
- Separate sun and moon GGX/Smith highlights use the same directions as their visible sky sources. Small animated slopes break up highlights without changing the diffuse faceted geometry. A shared scalar brightness compression preserves gold/silver colour instead of saturating individual channels to white. Foam is composited afterwards and obscures the reflective layer.

The dot-pattern correction replaces fixed sine-wave interference with the analytic gradients of two rotated simplex fields. The dominant slopes remain the actual wave faces; small-scale slopes have lower amplitude and elongated, irregular shapes. First derivatives of world position estimate the pixel footprint and filter unresolved detail into roughness. Do not differentiate the reflection normal: its face-normal component is already derivative-based, so doing so introduces undefined higher-order derivatives and can produce GPU-dependent pixel patterns.

Updated visual checks: `docs/images/reflection-irregular-sunset.png` and `docs/images/reflection-irregular-night.png`. These retain the geometric facets while removing the repeating fine ripple pattern. The derivative regression test guards against reintroducing derivatives of the reconstructed normal.

The lighting panel exposes **倒影强度** (`fresnelStrength`) and **水面粗糙度** (`roughness`). Existing highlight strength, sharpness and breakup controls remain live. The moon disc is larger so its position can be identified against the corresponding light path.

This is a mean-sea-plane reflection approximation, not ray tracing against the displaced ocean. Strong wave occlusion, nearby tall objects and off-screen geometry can still show approximation errors. One extra scene pass is rendered each frame; its resolution adapts to the viewport. `data-render-fps` and `data-reflection-size` on the canvas expose coarse runtime diagnostics. A Chrome check at the current viewport reported about 60 FPS with a 512×256 capture; this is not a cross-device performance guarantee.

Validation includes typechecking, unit/control-contract tests, lint, a production build, viewport resizing, four daylight presets, and comparing paused canvas screenshots with reflections disabled/enabled while hiding the control panel. Manual captures are in `docs/images/reflection-sunset.png` and `docs/images/reflection-night.png`.
