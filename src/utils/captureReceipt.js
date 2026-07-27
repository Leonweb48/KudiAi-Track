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
 *  - allowTaint:true + useCORS:true covers same-origin assets (logo-tp.png,
 *    network icons) without needing explicit CORS headers.
 *
 *  onclone pill fix (html2canvas v1 flex-child background bug):
 *  html2canvas v1 does not fully implement CSS flex layout. Flex children have
 *  their background painted at the *containing-block* width, not their own
 *  content width — the status pill balloons to the full card width in the
 *  captured PNG/PDF even though the screen render is correct. The onclone hook
 *  converts each pill to an explicit-width block box (measured from the live
 *  DOM before html2canvas starts) so the background is painted at the right
 *  pixel size. On-screen appearance is completely unchanged.
 */
import html2canvas from 'html2canvas';

export async function captureReceiptCanvas(el) {
  const cardWidth = el.offsetWidth;

  // Measure pill widths from the live DOM before cloning.
  // getBoundingClientRect().width is the border-box width as the browser
  // computed it — the exact value we hand back to html2canvas via onclone.
  const pillWidths = Array.from(el.querySelectorAll('[data-receipt-pill]'))
    .map(p => Math.ceil(p.getBoundingClientRect().width));

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
      backgroundColor: '#f1f5f9',
      onclone: (_clonedDoc, clonedRoot) => {
        // Fix: html2canvas v1 paints flex-child backgrounds at containing-block
        // width. Convert each pill to an explicit-width block box with margin:auto
        // centering. The outer flex wrapper becomes a plain block so html2canvas
        // has no flex context to misinterpret. Pixel widths come from the live
        // DOM where the browser already computed them correctly.
        const clonedPills = clonedRoot.querySelectorAll('[data-receipt-pill]');
        [...clonedPills].forEach((pill, i) => {
          const w = pillWidths[i];
          if (!w) return;
          const wrapper = pill.parentElement;
          if (wrapper) {
            wrapper.style.display   = 'block';
            wrapper.style.textAlign = '';
          }
          Object.assign(pill.style, {
            display:   'block',
            width:     w + 'px',
            margin:    '0 auto',
            boxSizing: 'border-box',
            textAlign: 'center',
          });
        });
      },
    });
  } finally {
    document.body.removeChild(wrap);
  }
}
