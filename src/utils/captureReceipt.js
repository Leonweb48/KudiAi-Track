/**
 * Captures a DOM element as a high-res canvas — pixel-identical to what the
 * user sees on screen.
 *
 * Key rules:
 *  - The wrapper must be VISIBLE (no visibility:hidden / opacity:0 / zIndex:-1)
 *    or html2canvas renders a completely blank canvas.
 *  - position:absolute left:-9999px keeps it off-screen without hiding it.
 *  - Waits for every <img> to fully load so logos and icons appear.
 *  - Awaits document.fonts.ready before capture so web fonts are guaranteed to
 *    be available (without this, fallback glyphs may render in the PNG/PDF).
 *  - Does NOT override windowWidth/windowHeight — those shift the layout.
 *  - allowTaint:true + useCORS:true covers same-origin assets (logo.png,
 *    network icons) without needing explicit CORS headers.
 */
import html2canvas from 'html2canvas';

export async function captureReceiptCanvas(el) {
  const cardWidth = el.offsetWidth;

  // Clone into an off-screen wrapper at the same width as the live card.
  // IMPORTANT: do not set visibility:hidden or zIndex:-1 — that blanks the output.
  const clone = el.cloneNode(true);
  const wrap  = document.createElement('div');
  Object.assign(wrap.style, {
    position: 'absolute',
    top:      '0',
    left:     '-9999px',
    width:    `${cardWidth}px`,
  });
  wrap.appendChild(clone);
  document.body.appendChild(wrap);

  // Wait for every image inside the clone to finish loading so logos appear.
  const imgs = Array.from(clone.querySelectorAll('img'));
  await Promise.all(
    imgs.map(img =>
      img.complete
        ? Promise.resolve()
        : new Promise(res => { img.onload = res; img.onerror = res; })
    )
  );

  // Await font load before capture so no glyph substitution occurs in PNG/PDF.
  // Resolves immediately for system fonts; waits for any declared web fonts.
  await document.fonts.ready;

  // Extra frame for layout paint to settle after font metrics are resolved.
  await new Promise(r => setTimeout(r, 120));

  try {
    return await html2canvas(clone, {
      scale:           3,
      useCORS:         true,
      allowTaint:      true,
      logging:         false,
      imageTimeout:    15000,
      width:           cardWidth,
      height:          clone.scrollHeight,
      backgroundColor: '#f1f5f9',  // OUTER_BG — prevents transparent bleed if any pixel misses root bg
    });
  } finally {
    document.body.removeChild(wrap);
  }
}
