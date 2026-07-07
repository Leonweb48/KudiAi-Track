/**
 * Captures a DOM element as a high-res canvas — pixel-identical to what the
 * user sees on screen.
 *
 * Key fixes over naive html2canvas usage:
 *  - Uses position:fixed so the clone is rendered at the exact same width as
 *    the live element, unaffected by page scroll.
 *  - Waits for every <img> inside the clone to fully load before snapping —
 *    this ensures logos, provider icons, and the KudiAI brand mark appear.
 *  - Does NOT override windowWidth/windowHeight, so html2canvas uses the real
 *    viewport and the layout matches what was on screen.
 *  - allowTaint:true covers same-origin assets (logo.png, network icons) that
 *    don't need CORS headers.
 */
import html2canvas from 'html2canvas';

export async function captureReceiptCanvas(el) {
  const cardWidth = el.offsetWidth;

  // Clone into a fixed off-screen wrapper at the same width as the live card.
  const clone = el.cloneNode(true);
  const wrap  = document.createElement('div');
  Object.assign(wrap.style, {
    position:   'fixed',
    top:        '0',
    left:       '-9999px',
    width:      `${cardWidth}px`,
    zIndex:     '-1',
    visibility: 'hidden',
  });
  wrap.appendChild(clone);
  document.body.appendChild(wrap);

  // Wait for every image inside the clone to finish loading so logos show up.
  const imgs = Array.from(clone.querySelectorAll('img'));
  await Promise.all(
    imgs.map(img =>
      img.complete
        ? Promise.resolve()
        : new Promise(res => { img.onload = res; img.onerror = res; })
    )
  );

  // Give the browser one extra frame to settle fonts and layout.
  await new Promise(r => setTimeout(r, 220));

  try {
    return await html2canvas(clone, {
      scale:        3,
      useCORS:      true,
      allowTaint:   true,
      logging:      false,
      imageTimeout: 15000,
      // Use the card's exact on-screen width; let height be natural scroll height.
      width:        cardWidth,
      height:       clone.scrollHeight,
      // Do NOT override windowWidth/windowHeight — that shifts the layout.
    });
  } finally {
    document.body.removeChild(wrap);
  }
}
